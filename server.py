#!/usr/bin/env python3
"""Authenticated server for local use and a synthetic hosted demo."""
from __future__ import annotations

import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
PRIVATE = Path(os.environ.get("APP_DATA_DIR", str(ROOT / "private"))).resolve()
DB_PATH = PRIVATE / "application.sqlite3"
SEED_PATH = ROOT / "seed_data.json"
CUMULATIVE_SEED_PATH = ROOT / "cumulative_seed.json"
HOST = os.environ.get("HOST", "0.0.0.0" if os.environ.get("RENDER") else "127.0.0.1")
PORT = int(os.environ.get("PORT", "8765"))
SECURE_COOKIE = "; Secure" if os.environ.get("RENDER") else ""
SESSION_SECONDS = 8 * 60 * 60
PBKDF2_ITERATIONS = 310_000
BODY_LIMIT = 5 * 1024 * 1024
ROLES = {"admin", "supervisor", "viewer"}
ROLE_LABELS = {"admin": "مشرف النظام", "supervisor": "مشرف", "viewer": "مستخدم للعرض"}
SESSIONS: dict[str, tuple[int, float]] = {}
LOGIN_FAILURES: dict[str, list[float]] = {}


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def normalize_gender(value, default="female"):
    value = str(value if value not in (None, "") else default).strip().casefold()
    if value in {"male", "m", "ذكر", "تلميذ", "طالب", "ولد"}:
        return "male"
    if value in {"female", "f", "أنثى", "انثى", "تلميذة", "طالبة", "بنت"}:
        return "female"
    raise ValueError("اختاري النوع: تلميذ أو تلميذة.")


def db():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def password_hash(password: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)


def valid_password(password: str, username: str) -> bool:
    return len(password) >= 12 and password.casefold() != username.casefold()


def init_db():
    PRIVATE.mkdir(parents=True, exist_ok=True)
    with db() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE COLLATE NOCASE,
            display_name TEXT NOT NULL,
            salt BLOB NOT NULL,
            password_hash BLOB NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('admin','supervisor','viewer')),
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            created_by INTEGER
        );
        CREATE TABLE IF NOT EXISTS students (
            id TEXT PRIMARY KEY,
            student_index INTEGER NOT NULL,
            grade_id TEXT NOT NULL DEFAULT 'grade-1',
            name TEXT NOT NULL,
            gender TEXT NOT NULL DEFAULT 'female',
            grades_json TEXT NOT NULL,
            total REAL NOT NULL,
            percent REAL NOT NULL,
            category TEXT NOT NULL,
            weaknesses_json TEXT NOT NULL,
            strengths_json TEXT NOT NULL,
            absences INTEGER NOT NULL,
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            created_by INTEGER,
            updated_by INTEGER,
            deleted_at TEXT
        );
        CREATE TABLE IF NOT EXISTS cumulative_records (
            id TEXT PRIMARY KEY,
            student_index INTEGER NOT NULL,
            grade_name TEXT NOT NULL,
            gender TEXT NOT NULL CHECK(gender IN ('male','female')),
            name TEXT NOT NULL,
            phone TEXT NOT NULL DEFAULT '',
            whatsapp TEXT NOT NULL DEFAULT '',
            previous_total TEXT NOT NULL DEFAULT '',
            previous_school TEXT NOT NULL DEFAULT '',
            father_occupation TEXT NOT NULL DEFAULT '',
            mother_name TEXT NOT NULL DEFAULT '',
            mother_occupation TEXT NOT NULL DEFAULT '',
            address TEXT NOT NULL DEFAULT '',
            transport TEXT NOT NULL DEFAULT '',
            term1 TEXT NOT NULL DEFAULT '',
            term2 TEXT NOT NULL DEFAULT '',
            term3 TEXT NOT NULL DEFAULT '',
            term4 TEXT NOT NULL DEFAULT '',
            source_file TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            updated_by INTEGER
        );
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            actor_id INTEGER,
            action TEXT NOT NULL,
            target TEXT NOT NULL,
            detail TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(actor_id) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_students_active_name ON students(active, name);
        CREATE INDEX IF NOT EXISTS idx_cumulative_name ON cumulative_records(name);
        CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_log(created_at);
        """)
        student_columns = {row[1] for row in conn.execute("PRAGMA table_info(students)")}
        if "grade_id" not in student_columns:
            conn.execute("ALTER TABLE students ADD COLUMN grade_id TEXT NOT NULL DEFAULT 'grade-1'")
        if "gender" not in student_columns:
            conn.execute("ALTER TABLE students ADD COLUMN gender TEXT NOT NULL DEFAULT 'female'")
        if conn.execute("SELECT value FROM meta WHERE key='cumulative_seeded' ").fetchone() is None:
            cumulative_seed = CUMULATIVE_SEED_PATH
            if cumulative_seed.exists():
                records = json.loads(cumulative_seed.read_text(encoding="utf-8"))
                for record in records:
                    conn.execute("""INSERT OR IGNORE INTO cumulative_records
                        (id,student_index,grade_name,gender,name,phone,whatsapp,previous_total,previous_school,
                         father_occupation,mother_name,mother_occupation,address,transport,term1,term2,term3,term4,
                         source_file,created_at,updated_at)
                        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (record["id"],record["studentIndex"],record["grade"],record["gender"],record["name"],
                         record.get("phone",""),record.get("whatsapp",""),record.get("previousTotal",""),
                         record.get("previousSchool",""),record.get("fatherOccupation",""),record.get("motherName",""),
                         record.get("motherOccupation",""),record.get("address",""),record.get("transport",""),
                         record.get("term1",""),record.get("term2",""),record.get("term3",""),record.get("term4",""),
                         record.get("sourceFile",""),now(),now()))
            conn.execute("INSERT OR REPLACE INTO meta(key,value) VALUES('cumulative_seeded','1')")
        if conn.execute("SELECT value FROM meta WHERE key='seeded'").fetchone() is None:
            if not SEED_PATH.exists():
                raise RuntimeError("Private initial data file is missing.")
            seed = json.loads(SEED_PATH.read_text(encoding="utf-8"))
            for s in seed["students"]:
                conn.execute("""INSERT OR IGNORE INTO students
                    (id,student_index,name,grades_json,total,percent,category,weaknesses_json,strengths_json,absences,created_at,updated_at)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (s["id"], int(s["index"]), s["name"], json.dumps(s["grades"], ensure_ascii=False),
                     float(s["total"]), float(s["percent"]), s["category"], json.dumps(s["weaknesses"], ensure_ascii=False),
                     json.dumps(s["strengths"], ensure_ascii=False), int(s["absences"]), now(), now()))
            conn.execute("INSERT OR REPLACE INTO meta(key,value) VALUES('data_model',?)", (json.dumps({
                "subjects": seed["subjects"], "criteria": seed["criteria"], "summary": seed["summary"]
            }, ensure_ascii=False),))
            conn.execute("INSERT OR REPLACE INTO meta(key,value) VALUES('seeded','yes')")
        grade_models(conn)


def grade_models(conn):
    row = conn.execute("SELECT value FROM meta WHERE key='grade_models'").fetchone()
    if row:
        models = json.loads(row[0])
    else:
        legacy = json.loads(conn.execute("SELECT value FROM meta WHERE key='data_model'").fetchone()[0])
        models = [{"id": "grade-1", "name": "الصف الحالي", "subjects": legacy["subjects"], "criteria": legacy["criteria"]}]
        row = None
    changed = row is None
    for model in models:
        for rule in model.get("criteria", {}).get("subjects", {}).values():
            maximum = float(rule.get("max", 0) or 0)
            if maximum <= 0:
                continue
            for rate_key, score_key, fallback in (("passRate", "pass", 50), ("weakRate", "weak", 60), ("excellentRate", "excellent", 90)):
                if rate_key not in rule:
                    rule[rate_key] = float(rule.get(score_key, maximum * fallback / 100)) / maximum * 100
                    changed = True
                rule[score_key] = maximum * float(rule[rate_key]) / 100
    if changed:
        conn.execute("INSERT OR REPLACE INTO meta(key,value) VALUES('grade_models',?)", (json.dumps(models, ensure_ascii=False),))
    return models


def find_grade(models, grade_id):
    return next((item for item in models if item["id"] == grade_id), None)


def build_grade_model(grade_id, name, subjects, min_strength=3, min_support=2):
    name = str(name or "").strip()
    if not name or len(name) > 80:
        raise ValueError("أدخلي اسمًا للصف لا يتجاوز 80 حرفًا.")
    if not isinstance(subjects, list) or len(subjects) > 40:
        raise ValueError("قائمة المواد غير صالحة.")
    clean_subjects, rules, seen = [], {}, set()
    for item in subjects:
        if not isinstance(item, dict):
            raise ValueError("صيغة إحدى المواد غير صالحة.")
        subject = str(item.get("name", "")).strip()
        if not subject or len(subject) > 80 or subject.casefold() in seen:
            raise ValueError("أسماء المواد مطلوبة ويجب ألا تتكرر.")
        seen.add(subject.casefold())
        numbers = {}
        for key in ("max",):
            value = item.get(key)
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValueError(f"تحققي من حدود درجات مادة {subject}.")
            numbers[key] = float(value)
        if not 0 < numbers["max"] <= 1000:
            raise ValueError(f"النهاية العظمى غير صالحة في مادة {subject}.")
        for rate_key, old_key, fallback in (("passRate", "pass", 50), ("weakRate", "weak", 60), ("excellentRate", "excellent", 90)):
            value = item.get(rate_key)
            if value is None:
                value = item.get(old_key, numbers["max"] * fallback / 100)
                value = float(value) / numbers["max"] * 100
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 100:
                raise ValueError(f"يجب إدخال نسبة مئوية بين 0 و100 لمادة {subject}.")
            numbers[rate_key] = float(value)
        if not (numbers["passRate"] <= numbers["weakRate"] <= numbers["excellentRate"]):
            raise ValueError(f"رتبي نسب النجاح والضعف والتميز تصاعديًا في مادة {subject}.")
        numbers["pass"] = numbers["max"] * numbers["passRate"] / 100
        numbers["weak"] = numbers["max"] * numbers["weakRate"] / 100
        numbers["excellent"] = numbers["max"] * numbers["excellentRate"] / 100
        rules[subject] = numbers
        clean_subjects.append({"name": subject, "average": 0, "averageRate": 0, "passRate": 0, "failed": 0, "weak": 0, "excellent": 0})
    if isinstance(min_strength, bool) or not isinstance(min_strength, int) or min_strength < 1 or min_strength > 40:
        raise ValueError("حد مواد التميز غير صالح.")
    if isinstance(min_support, bool) or not isinstance(min_support, int) or min_support < 1 or min_support > 40:
        raise ValueError("حد مواد الدعم غير صالح.")
    return {"id": grade_id, "name": name, "subjects": clean_subjects,
            "criteria": {"minStrengthSubjects": min_strength, "minSupportSubjects": min_support, "subjects": rules}}


def get_user(user_id):
    with db() as conn:
        row = conn.execute("SELECT id,username,display_name,role,active FROM users WHERE id=?", (user_id,)).fetchone()
    return dict(row) if row else None


def state_payload(user):
    with db() as conn:
        data = json.loads(conn.execute("SELECT value FROM meta WHERE key='data_model'").fetchone()[0])
        models = grade_models(conn)
        rows = conn.execute("""SELECT id,student_index,grade_id,name,gender,grades_json,total,percent,category,weaknesses_json,strengths_json,absences
                              FROM students WHERE active=1 ORDER BY student_index,id""").fetchall()
    models_by_id = {item["id"]: item for item in models}
    for model in models:
        for rule in model["criteria"]["subjects"].values():
            maximum=rule["max"]
            rule["pass"]=maximum*rule["passRate"]/100
            rule["weak"]=maximum*rule["weakRate"]/100
            rule["excellent"]=maximum*rule["excellentRate"]/100
    data["students"] = [{
        "id": r["id"], "index": r["student_index"], "gradeId": r["grade_id"], "name": r["name"], "gender": r["gender"], "grades": json.loads(r["grades_json"]),
        **dict(zip(("total","percent","category","weaknesses","strengths","absences"),
                   evaluate_student(r["name"], json.loads(r["grades_json"]), models_by_id.get(r["grade_id"], models[0])["criteria"], r["gender"])))
    } for r in rows]
    data["grades"] = models
    with db() as conn:
        all_ids=[r[0] for r in conn.execute("SELECT id FROM students")]
    max_id=max((int(match.group(1)) for value in all_ids if (match:=re.search(r"(\d+)$",value))),default=0)
    next_id=f"STU-{max_id+1:04d}"
    while next_id in all_ids:
        max_id+=1
        next_id=f"STU-{max_id+1:04d}"
    data["nextStudentId"]=next_id
    data["user"] = {"id": user["id"], "username": user["username"], "displayName": user["display_name"],
                    "role": user["role"], "roleLabel": ROLE_LABELS[user["role"]]}
    return data


def evaluate_student(name, grades, criteria, gender="female"):
    total = 0.0
    max_present = 0.0
    absences = 0
    weaknesses, strengths, failed = [], [], []
    incomplete = False
    for subject in criteria["subjects"]:
        value = grades[subject]
        rule = criteria["subjects"][subject]
        if value == "غ":
            absences += 1
            continue
        if value is None or value == "":
            incomplete = True
            continue
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0 or value > rule["max"]:
            raise ValueError(f"درجة غير صالحة في مادة {subject} للسجل {name}.")
        total += value
        max_present += rule["max"]
        if value < rule["pass"]:
            failed.append(subject)
            weaknesses.append(subject)
        elif value < rule["weak"]:
            weaknesses.append(subject)
        if value >= rule["excellent"]:
            strengths.append(subject)
    if incomplete:
        category = "بيانات ناقصة"
    elif not max_present:
        category = "غير مصنفة"
    else:
        category = None
    weak_count, strong_count = len(weaknesses), len(strengths)
    if category is None and weak_count >= criteria["minSupportSubjects"]:
        category = "يحتاج خطة دعم شاملة" if gender == "male" else "تحتاج خطة دعم شاملة"
    elif category is None and weak_count >= 1 and strong_count >= 1:
        category = "متفاوت الأداء" if gender == "male" else "متفاوتة الأداء"
    elif category is None and weak_count >= 1:
        category = "يحتاج دعماً في مادة محددة" if gender == "male" else "تحتاج دعماً في مادة محددة"
    elif category is None and strong_count >= criteria["minStrengthSubjects"]:
        category = "متفوق شامل" if gender == "male" else "متفوقة شاملة"
    elif category is None and strong_count >= 1:
        category = "متميز في مادة/مواد" if gender == "male" else "متميزة في مادة/مواد"
    elif category is None:
        category = "أداء مستقر"
    present_max=sum(criteria["subjects"][s]["max"] for s,v in grades.items() if isinstance(v,(int,float)) and not isinstance(v,bool))
    is_complete=all(grades.get(s) == "غ" or isinstance(grades.get(s),(int,float)) and not isinstance(grades.get(s),bool) for s in criteria["subjects"])
    percent=total/present_max*100 if is_complete and present_max else None
    return total, percent, category, weaknesses, strengths, absences


class AppHandler(BaseHTTPRequestHandler):
    server_version = "StudentResults/1.0"
    sys_version = ""

    def log_message(self, fmt, *args):
        # Keep request logs free of personal values and query strings.
        print(f"{self.log_date_time_string()} {self.command} {urlparse(self.path).path} {args[1] if len(args)>1 else ''}")

    def headers_security(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
        self.send_header("Cache-Control", "no-store")

    def send_json(self, status, value, extra_headers=None):
        body = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.headers_security()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        for key, val in (extra_headers or {}).items():
            self.send_header(key, val)
        self.end_headers()
        self.wfile.write(body)

    def fail(self, status, message):
        self.send_json(status, {"error": message})

    def body_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > BODY_LIMIT:
            raise ValueError("حجم الطلب غير صالح.")
        data = json.loads(self.rfile.read(length).decode("utf-8"))
        if not isinstance(data, dict):
            raise ValueError("صيغة الطلب غير صالحة.")
        return data

    def request_origin_ok(self):
        host = self.headers.get("Host", "").strip().lower()
        origin = self.headers.get("Origin")
        if not host or not origin:
            return False
        parsed = urlparse(origin)
        if parsed.netloc.lower() != host or parsed.path or parsed.params or parsed.query or parsed.fragment:
            return False
        if os.environ.get("RENDER"):
            return parsed.scheme == "https"
        return parsed.scheme == "http" and host in {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}
    def actor(self):
        cookie = self.headers.get("Cookie", "")
        token = next((part.strip().split("=", 1)[1] for part in cookie.split(";") if part.strip().startswith("sid=")), None)
        if not token:
            return None
        session = SESSIONS.get(token)
        if not session or session[1] < time.time():
            SESSIONS.pop(token, None)
            return None
        user = get_user(session[0])
        if not user or not user["active"]:
            SESSIONS.pop(token, None)
            return None
        return user

    def need_user(self):
        user = self.actor()
        if not user:
            self.fail(401, "يلزم تسجيل الدخول.")
            return None
        return user

    def need_role(self, roles):
        user = self.need_user()
        if not user:
            return None
        if user["role"] not in roles:
            self.fail(403, "ليس لديك صلاحية لتنفيذ هذا الإجراء.")
            return None
        return user

    def audit(self, actor_id, action, target, detail=""):
        with db() as conn:
            conn.execute("INSERT INTO audit_log(actor_id,action,target,detail,created_at) VALUES(?,?,?,?,?)",
                         (actor_id, action, target, detail[:400], now()))

    def do_GET(self):
        path = unquote(urlparse(self.path).path)
        try:
            if path == "/api/setup-status":
                with db() as conn:
                    has_users = conn.execute("SELECT EXISTS(SELECT 1 FROM users)").fetchone()[0]
                self.send_json(200, {"needsSetup": not bool(has_users), "setupKeyRequired": bool(os.environ.get("INITIAL_ADMIN_KEY"))})
                return
            if path == "/api/session":
                user = self.need_user()
                if user:
                    self.send_json(200, state_payload(user))
                return
            if path == "/api/users":
                user = self.need_role({"admin"})
                if not user:
                    return
                with db() as conn:
                    users = [dict(row) for row in conn.execute("SELECT id,username,display_name,role,active,created_at FROM users ORDER BY id")]
                self.send_json(200, {"users": users, "roles": ROLE_LABELS, "currentUserId": user["id"]})
                return
            if path == "/api/cumulative":
                user = self.need_user()
                if not user:
                    return
                with db() as conn:
                    rows = conn.execute("""SELECT id,student_index AS studentIndex,grade_name AS grade,
                        gender,name,phone,whatsapp,previous_total AS previousTotal,previous_school AS previousSchool,
                        father_occupation AS fatherOccupation,mother_name AS motherName,
                        mother_occupation AS motherOccupation,address,transport,term1,term2,term3,term4,source_file AS sourceFile
                        FROM cumulative_records ORDER BY gender,student_index,name""").fetchall()
                self.send_json(200, {"records": [dict(row) for row in rows]})
                return
            if path in {"/", "/index.html", "/styles.css", "/app.js", "/auth.js", "/icons.js"}:
                filename = "index.html" if path == "/" else path.lstrip("/")
                file_path = ROOT / filename
                if not file_path.is_file():
                    self.fail(404, "الملف غير موجود.")
                    return
                body = file_path.read_bytes()
                self.send_response(200)
                self.headers_security()
                self.send_header("Content-Type", mimetypes.guess_type(filename)[0] + ("; charset=utf-8" if filename.endswith((".html", ".css", ".js")) else ""))
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            self.fail(404, "المسار غير موجود.")
        except Exception:
            self.fail(500, "حدث خطأ داخلي. راجعي سجل الخادم المحلي.")

    def do_POST(self):
        if not self.request_origin_ok():
            self.fail(403, "تم رفض الطلب من مصدر غير موثوق.")
            return
        path = unquote(urlparse(self.path).path)
        try:
            payload = self.body_json()
            if path == "/api/setup":
                initial_admin_key = os.environ.get("INITIAL_ADMIN_KEY", "")
                if initial_admin_key and not hmac.compare_digest(str(payload.get("setupKey", "")), initial_admin_key):
                    self.fail(403, "أدخلي رمز الإعداد الموجود في إعدادات خدمة Render.")
                    return
                with db() as conn:
                    conn.execute("BEGIN IMMEDIATE")
                    if conn.execute("SELECT EXISTS(SELECT 1 FROM users)").fetchone()[0]:
                        self.fail(409, "تم إعداد مشرف النظام مسبقًا.")
                        return
                    username = str(payload.get("username", "")).strip()
                    display_name = str(payload.get("displayName", "")).strip()
                    password = str(payload.get("password", ""))
                    if not re.fullmatch(r"[A-Za-z0-9_.-]{3,40}", username) or not display_name:
                        self.fail(400, "أدخلي اسم مستخدم من 3 إلى 40 حرفًا واسمًا ظاهرًا.")
                        return
                    if not valid_password(password, username):
                        self.fail(400, "كلمة المرور يجب أن تكون 12 حرفًا على الأقل ولا تطابق اسم المستخدم.")
                        return
                    salt = secrets.token_bytes(16)
                    cur = conn.execute("INSERT INTO users(username,display_name,salt,password_hash,role,active,created_at) VALUES(?,?,?,?,?,?,?)",
                                       (username, display_name, salt, password_hash(password, salt), "admin", 1, now()))
                    user_id = cur.lastrowid
                    conn.execute("INSERT INTO audit_log(actor_id,action,target,detail,created_at) VALUES(?,?,?,?,?)",
                                 (user_id, "initial_admin_created", str(user_id), "", now()))
                token = secrets.token_urlsafe(32)
                SESSIONS[token] = (user_id, time.time() + SESSION_SECONDS)
                user = get_user(user_id)
                self.send_json(201, {"ok": True}, {"Set-Cookie": f"sid={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={SESSION_SECONDS}{SECURE_COOKIE}"})
                return
            if path == "/api/login":
                username = str(payload.get("username", "")).strip()
                password = str(payload.get("password", ""))
                ip = self.client_address[0]
                key = f"{ip}:{username.casefold()}"
                recent = [t for t in LOGIN_FAILURES.get(key, []) if t > time.time() - 900]
                if len(recent) >= 8:
                    self.fail(429, "محاولات كثيرة. انتظري 15 دقيقة ثم أعيدي المحاولة.")
                    return
                with db() as conn:
                    row = conn.execute("SELECT * FROM users WHERE username=? COLLATE NOCASE AND active=1", (username,)).fetchone()
                valid = bool(row and hmac.compare_digest(password_hash(password, row["salt"]), row["password_hash"]))
                if not valid:
                    recent.append(time.time())
                    LOGIN_FAILURES[key] = recent
                    self.fail(401, "اسم المستخدم أو كلمة المرور غير صحيحة.")
                    return
                LOGIN_FAILURES.pop(key, None)
                token = secrets.token_urlsafe(32)
                SESSIONS[token] = (row["id"], time.time() + SESSION_SECONDS)
                self.send_json(200, {"ok": True}, {"Set-Cookie": f"sid={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={SESSION_SECONDS}{SECURE_COOKIE}"})
                return
            if path == "/api/logout":
                cookie = self.headers.get("Cookie", "")
                token = next((p.strip().split("=", 1)[1] for p in cookie.split(";") if p.strip().startswith("sid=")), None)
                if token:
                    SESSIONS.pop(token, None)
                self.send_json(200, {"ok": True}, {"Set-Cookie": "sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"})
                return
            if path == "/api/students":
                user = self.need_role({"admin", "supervisor"})
                if not user:
                    return
                self.create_or_update_student(payload, user)
                return
            if path == "/api/cumulative":
                user = self.need_role({"admin", "supervisor"})
                if not user:
                    return
                fields = {
                    "name": ("name", 100), "phone": ("phone", 40), "whatsapp": ("whatsapp", 40),
                    "previousTotal": ("previous_total", 120), "previousSchool": ("previous_school", 160),
                    "fatherOccupation": ("father_occupation", 120), "motherName": ("mother_name", 120),
                    "motherOccupation": ("mother_occupation", 120), "address": ("address", 200),
                    "transport": ("transport", 120), "term1": ("term1", 60), "term2": ("term2", 60),
                    "term3": ("term3", 60), "term4": ("term4", 60),
                }
                values = {}
                for key, (column, limit) in fields.items():
                    value = str(payload.get(key, "") or "").strip()
                    if len(value) > limit:
                        raise ValueError(f"القيمة في حقل {key} أطول من المسموح.")
                    values[column] = value
                if not values["name"]:
                    raise ValueError("اكتبي اسم التلميذ أو التلميذة.")
                gender = normalize_gender(payload.get("gender"))
                grade_name = str(payload.get("grade", "الصف السادس")).strip()[:80] or "الصف السادس"
                try:
                    student_index = int(payload.get("studentIndex") or 0)
                except (ValueError, TypeError):
                    student_index = 0
                if student_index < 0 or student_index > 10000:
                    raise ValueError("رقم السجل يجب أن يكون بين 1 و10000.")
                record_id = str(payload.get("id", "")).strip() or f"CUM-{secrets.token_hex(6).upper()}"
                if len(record_id) > 80:
                    raise ValueError("معرّف السجل غير صالح.")
                timestamp = now()
                columns = ["name", "phone", "whatsapp", "previous_total", "previous_school", "father_occupation",
                           "mother_name", "mother_occupation", "address", "transport", "term1", "term2", "term3", "term4"]
                with db() as conn:
                    existing = conn.execute("SELECT id FROM cumulative_records WHERE id=?", (record_id,)).fetchone()
                    if not existing:
                        index = student_index or conn.execute("SELECT COALESCE(MAX(student_index),0)+1 FROM cumulative_records WHERE gender=? AND grade_name=?", (gender, grade_name)).fetchone()[0]
                    else:
                        index = student_index or conn.execute("SELECT student_index FROM cumulative_records WHERE id=?", (record_id,)).fetchone()[0]
                    duplicate = conn.execute("SELECT 1 FROM cumulative_records WHERE gender=? AND grade_name=? AND student_index=? AND id<>?", (gender,grade_name,index,record_id)).fetchone()
                    if duplicate:
                        raise ValueError("رقم السجل مستخدم بالفعل لهذا النوع والصف.")
                    insert_columns = ["id", "student_index", "grade_name", "gender", *columns, "created_at", "updated_at", "updated_by"]
                    insert_values = [record_id, index, grade_name, gender, *[values[column] for column in columns], timestamp, timestamp, user["id"]]
                    updates = ",".join(f"{column}=excluded.{column}" for column in ["student_index", "grade_name", "gender", *columns, "updated_at", "updated_by"])
                    conn.execute(f"INSERT INTO cumulative_records({','.join(insert_columns)}) VALUES({','.join('?' for _ in insert_columns)}) ON CONFLICT(id) DO UPDATE SET {updates}", insert_values)
                    conn.execute("INSERT INTO audit_log(actor_id,action,target,detail,created_at) VALUES(?,?,?,?,?)",
                                 (user["id"], "cumulative_record_saved", record_id, f"gender={gender};grade={grade_name}", timestamp))
                self.send_json(200, {"ok": True, "id": record_id, "studentIndex": index})
                return
            if path == "/api/import":
                user = self.need_role({"admin", "supervisor"})
                if not user:
                    return
                records = payload.get("records")
                if not isinstance(records, list) or not records or len(records) > 1000:
                    self.fail(400, "قائمة السجلات المستوردة غير صالحة.")
                    return
                with db() as conn:
                    models = grade_models(conn)
                    seen = set()
                    additions = updates = 0
                    next_index = conn.execute("SELECT COALESCE(MAX(student_index),0)+1 FROM students").fetchone()[0]
                    prepared = []
                    for rec in records:
                        if not isinstance(rec, dict):
                            raise ValueError("أحد السجلات المستوردة ليس كائن بيانات صالحًا.")
                        name = str(rec.get("name", "")).strip()
                        sid = str(rec.get("id", "")).strip()
                        grade_id = str(rec.get("gradeId", "grade-1"))
                        grade = find_grade(models, grade_id)
                        if not grade:
                            raise ValueError("الصف المحدد للاستيراد غير موجود.")
                        criteria = grade["criteria"]
                        grades = rec.get("grades")
                        if not name or len(name) > 100 or not isinstance(grades, dict):
                            raise ValueError("يوجد سجل باسم أو درجات غير صالحة.")
                        if not sid:
                            sid = f"STU-{next_index:04d}"
                            while sid in seen or conn.execute("SELECT 1 FROM students WHERE id=?", (sid,)).fetchone():
                                next_index += 1
                                sid = f"STU-{next_index:04d}"
                        if sid in seen:
                            raise ValueError(f"المعرّف {sid} مكرر في الملف.")
                        seen.add(sid)
                        clean_grades = {subject: grades.get(subject) for subject in criteria["subjects"]}
                        old = conn.execute("SELECT student_index,created_at,grade_id,gender FROM students WHERE id=?", (sid,)).fetchone()
                        if old and old["grade_id"] != grade_id:
                            raise ValueError(f"المعرّف {sid} مسجل في صف آخر؛ لا يُنقل السجل بالاستيراد.")
                        gender = normalize_gender(rec.get("gender"), old["gender"] if old else "female")
                        total, percent, category, weak, strong, absences = evaluate_student(name, clean_grades, criteria, gender)
                        index = old["student_index"] if old else next_index
                        if old:
                            updates += 1
                        else:
                            additions += 1
                            next_index += 1
                        prepared.append((sid,index,grade_id,name,gender,clean_grades,total,percent,category,weak,strong,absences,old["created_at"] if old else now()))
                    timestamp = now()
                    for sid,index,grade_id,name,gender,grades,total,percent,category,weak,strong,absences,created in prepared:
                        conn.execute("""INSERT INTO students(id,student_index,grade_id,name,gender,grades_json,total,percent,category,weaknesses_json,strengths_json,absences,active,created_at,updated_at,created_by,updated_by,deleted_at)
                            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,NULL)
                            ON CONFLICT(id) DO UPDATE SET student_index=excluded.student_index,grade_id=excluded.grade_id,name=excluded.name,gender=excluded.gender,grades_json=excluded.grades_json,total=excluded.total,percent=excluded.percent,category=excluded.category,weaknesses_json=excluded.weaknesses_json,strengths_json=excluded.strengths_json,absences=excluded.absences,active=1,updated_at=excluded.updated_at,updated_by=excluded.updated_by,deleted_at=NULL""",
                            (sid,index,grade_id,name,gender,json.dumps(grades,ensure_ascii=False),total,percent if percent is not None else 0,category,json.dumps(weak,ensure_ascii=False),json.dumps(strong,ensure_ascii=False),absences,created,timestamp,user["id"],user["id"]))
                    conn.execute("INSERT INTO audit_log(actor_id,action,target,detail,created_at) VALUES(?,?,?,?,?)",
                                 (user["id"], "students_imported", "batch", f"records={len(prepared)};added={additions};updated={updates}", timestamp))
                self.send_json(200, {"ok": True, "added": additions, "updated": updates})
                return
            if path == "/api/grades":
                user = self.need_role({"admin"})
                if not user:
                    return
                name = str(payload.get("name", "")).strip()
                grade_id = "grade-" + secrets.token_hex(4)
                with db() as conn:
                    models = grade_models(conn)
                    if any(item["name"].casefold() == name.casefold() for item in models):
                        self.fail(409, "اسم الصف مستخدم بالفعل.")
                        return
                    item = build_grade_model(grade_id, name, [])
                    models.append(item)
                    conn.execute("UPDATE meta SET value=? WHERE key='grade_models'", (json.dumps(models, ensure_ascii=False),))
                    conn.execute("INSERT INTO audit_log(actor_id,action,target,detail,created_at) VALUES(?,?,?,?,?)",
                                 (user["id"], "grade_created", grade_id, name, now()))
                self.send_json(201, {"ok": True, "grade": item})
                return
            if path == "/api/users":
                user = self.need_role({"admin"})
                if not user:
                    return
                username = str(payload.get("username", "")).strip()
                display_name = str(payload.get("displayName", "")).strip()
                password = str(payload.get("password", ""))
                role = str(payload.get("role", ""))
                if not re.fullmatch(r"[A-Za-z0-9_.-]{3,40}", username) or not display_name or len(display_name)>100:
                    self.fail(400, "تحققي من الاسم الظاهر واسم المستخدم (3–40 حرفًا إنجليزيًا أو أرقامًا أو . _ -).")
                    return
                if role not in ROLES:
                    self.fail(400, "الدور المحدد غير صالح.")
                    return
                if not valid_password(password, username):
                    self.fail(400, "كلمة المرور يجب أن تكون 12 حرفًا على الأقل ولا تطابق اسم المستخدم.")
                    return
                salt = secrets.token_bytes(16)
                try:
                    with db() as conn:
                        cur=conn.execute("INSERT INTO users(username,display_name,salt,password_hash,role,active,created_at,created_by) VALUES(?,?,?,?,?,?,?,?)",
                                         (username,display_name,salt,password_hash(password,salt),role,1,now(),user["id"]))
                        new_id=cur.lastrowid
                        conn.execute("INSERT INTO audit_log(actor_id,action,target,detail,created_at) VALUES(?,?,?,?,?)",
                                     (user["id"],"user_created",str(new_id),f"role={role}",now()))
                except sqlite3.IntegrityError:
                    self.fail(409, "اسم المستخدم مستخدم بالفعل.")
                    return
                self.send_json(201, {"ok": True, "id": new_id})
                return
            self.fail(404, "المسار غير موجود.")
        except ValueError as exc:
            self.fail(400, str(exc))
        except Exception:
            self.fail(500, "حدث خطأ داخلي. لم تُعتمد العملية.")

    def create_or_update_student(self, payload, user):
        name = str(payload.get("name", "")).strip()
        try:
            gender = normalize_gender(payload.get("gender"))
        except ValueError as exc:
            self.fail(400, str(exc))
            return
        sid = str(payload.get("id", "")).strip()
        grade_id = str(payload.get("gradeId", "grade-1"))
        grades = payload.get("grades")
        if not name or len(name)>100 or not sid or len(sid)>40 or not isinstance(grades,dict):
            self.fail(400,"الاسم أو النوع أو المعرّف أو الدرجات غير صالحة.")
            return
        with db() as conn:
            grade=find_grade(grade_models(conn), grade_id)
            if not grade:
                self.fail(400,"اختاري صفًا دراسيًا صالحًا.")
                return
            criteria=grade["criteria"]
            clean={subject:grades.get(subject) for subject in criteria["subjects"]}
            total,percent,category,weak,strong,absences=evaluate_student(name,clean,criteria,gender)
            if not any(isinstance(value, (int, float)) and not isinstance(value, bool) for value in clean.values()):
                self.fail(400,"أدخلي درجة واحدة على الأقل.")
                return
            if conn.execute("SELECT 1 FROM students WHERE id=?",(sid,)).fetchone():
                self.fail(409,"هذا المعرّف موجود بالفعل.")
                return
            index=conn.execute("SELECT COALESCE(MAX(student_index),0)+1 FROM students").fetchone()[0]
            timestamp=now()
            conn.execute("INSERT INTO students(id,student_index,grade_id,name,gender,grades_json,total,percent,category,weaknesses_json,strengths_json,absences,active,created_at,updated_at,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)",
                         (sid,index,grade_id,name,gender,json.dumps(clean,ensure_ascii=False),total,percent if percent is not None else 0,category,json.dumps(weak,ensure_ascii=False),json.dumps(strong,ensure_ascii=False),absences,timestamp,timestamp,user["id"],user["id"]))
            conn.execute("INSERT INTO audit_log(actor_id,action,target,detail,created_at) VALUES(?,?,?,?,?)",
                         (user["id"],"student_added",sid,"",timestamp))
        self.send_json(201,{"ok":True,"added":1,"updated":0})

    def do_DELETE(self):
        if not self.request_origin_ok():
            self.fail(403,"تم رفض الطلب من مصدر غير موثوق.")
            return
        path=unquote(urlparse(self.path).path)
        if path.startswith("/api/grades/"):
            user=self.need_role({"admin"})
            if not user:return
            grade_id=path.removeprefix("/api/grades/")
            with db() as conn:
                models=grade_models(conn)
                grade=find_grade(models,grade_id)
                if not grade:
                    self.fail(404,"الصف غير موجود.")
                    return
                if len(models)<=1:
                    self.fail(400,"يجب الإبقاء على صف دراسي واحد على الأقل.")
                    return
                if conn.execute("SELECT 1 FROM students WHERE grade_id=? LIMIT 1",(grade_id,)).fetchone():
                    self.fail(409,"لا يمكن حذف صف لديه سجلات طالبات. انقلي السجلات أولًا.")
                    return
                models.remove(grade)
                conn.execute("UPDATE meta SET value=? WHERE key='grade_models'",(json.dumps(models,ensure_ascii=False),))
                conn.execute("INSERT INTO audit_log(actor_id,action,target,detail,created_at) VALUES(?,?,?,?,?)",
                             (user["id"],"grade_deleted",grade_id,grade["name"],now()))
            self.send_json(200,{"ok":True})
            return
        user=self.need_role({"admin","supervisor"})
        if not user:return
        cumulative_match=re.fullmatch(r"/api/cumulative/([^/]+)",path)
        if cumulative_match:
            record_id=cumulative_match.group(1)
            with db() as conn:
                row=conn.execute("SELECT id FROM cumulative_records WHERE id=?",(record_id,)).fetchone()
                if not row:
                    self.fail(404,"السجل التراكمي غير موجود.")
                    return
                conn.execute("DELETE FROM cumulative_records WHERE id=?",(record_id,))
                conn.execute("INSERT INTO audit_log(actor_id,action,target,detail,created_at) VALUES(?,?,?,?,?)",
                             (user["id"],"cumulative_record_deleted",record_id,"",now()))
            self.send_json(200,{"ok":True})
            return
        match=re.fullmatch(r"/api/students/([^/]+)",path)
        if not match:
            self.fail(404,"المسار غير موجود.")
            return
        sid=match.group(1)
        with db() as conn:
            row=conn.execute("SELECT active FROM students WHERE id=?",(sid,)).fetchone()
            if not row or not row["active"]:
                self.fail(404,"سجل الطالبة غير موجود أو محذوف.")
                return
            timestamp=now()
            conn.execute("UPDATE students SET active=0,deleted_at=?,updated_at=?,updated_by=? WHERE id=?",(timestamp,timestamp,user["id"],sid))
            conn.execute("INSERT INTO audit_log(actor_id,action,target,detail,created_at) VALUES(?,?,?,?,?)",
                         (user["id"],"student_soft_deleted",sid,"",timestamp))
        self.send_json(200,{"ok":True})

    def do_PUT(self):
        if not self.request_origin_ok():
            self.fail(403,"تم رفض الطلب من مصدر غير موثوق.")
            return
        user=self.need_role({"admin"})
        if not user:return
        match=re.fullmatch(r"/api/grades/([^/]+)",unquote(urlparse(self.path).path))
        if not match:
            self.fail(404,"المسار غير موجود.")
            return
        try:payload=self.body_json()
        except ValueError as exc:self.fail(400,str(exc));return
        grade_id=match.group(1)
        with db() as conn:
            models=grade_models(conn)
            old=find_grade(models,grade_id)
            if not old:
                self.fail(404,"الصف غير موجود.")
                return
            name=str(payload.get("name",old["name"])).strip()
            if any(item["id"]!=grade_id and item["name"].casefold()==name.casefold() for item in models):
                self.fail(409,"اسم الصف مستخدم بالفعل.")
                return
            defaults=old["criteria"]
            try:
                updated=build_grade_model(grade_id,name,payload.get("subjects"),
                                          defaults["minStrengthSubjects"],defaults["minSupportSubjects"])
            except ValueError as exc:
                self.fail(400,str(exc))
                return
            models[models.index(old)]=updated
            conn.execute("UPDATE meta SET value=? WHERE key='grade_models'",(json.dumps(models,ensure_ascii=False),))
            conn.execute("INSERT INTO audit_log(actor_id,action,target,detail,created_at) VALUES(?,?,?,?,?)",
                         (user["id"],"grade_updated",grade_id,f"name={name};subjects={len(updated['subjects'])}",now()))
        self.send_json(200,{"ok":True,"grade":updated})

    def do_PATCH(self):
        if not self.request_origin_ok():
            self.fail(403,"تم رفض الطلب من مصدر غير موثوق.")
            return
        user=self.need_role({"admin"})
        if not user:return
        match=re.fullmatch(r"/api/users/(\d+)/active",unquote(urlparse(self.path).path))
        if not match:
            self.fail(404,"المسار غير موجود.")
            return
        try:payload=self.body_json()
        except ValueError as exc:self.fail(400,str(exc));return
        target_id=int(match.group(1));active=payload.get("active")
        if not isinstance(active,bool):
            self.fail(400,"حالة الحساب غير صالحة.")
            return
        with db() as conn:
            target=conn.execute("SELECT id,role,active FROM users WHERE id=?",(target_id,)).fetchone()
            if not target:
                self.fail(404,"الحساب غير موجود.")
                return
            if not active and target_id==user["id"]:
                self.fail(400,"لا يمكن تعطيل حسابك الحالي.")
                return
            if not active and target["role"]=="admin" and target["active"]:
                count=conn.execute("SELECT COUNT(*) FROM users WHERE role='admin' AND active=1").fetchone()[0]
                if count<=1:
                    self.fail(400,"يجب إبقاء مشرف نظام واحد نشط على الأقل.")
                    return
            timestamp=now()
            conn.execute("UPDATE users SET active=? WHERE id=?",(int(active),target_id))
            conn.execute("INSERT INTO audit_log(actor_id,action,target,detail,created_at) VALUES(?,?,?,?,?)",
                         (user["id"],"user_activated" if active else "user_deactivated",str(target_id),"",timestamp))
        self.send_json(200,{"ok":True})


def main():
    init_db()
    httpd=ThreadingHTTPServer((HOST,PORT),AppHandler)
    print(f"Student Results app listening on {HOST}:{PORT}")
    print("Application database initialized.")
    try:httpd.serve_forever()
    except KeyboardInterrupt:print("Stopping local application server.")
    finally:httpd.server_close()


if __name__=="__main__":
    main()
