"""
YourPower Labs — Office Expense Tracker
Clean version with all features
"""

from fastapi import FastAPI, HTTPException, Depends, Header, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
import sqlite3, os, hashlib, secrets, shutil

app = FastAPI(title="YourPower Labs", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

DB_PATH    = os.path.join(os.path.dirname(__file__), "data", "expenses.db")
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

# ── DB ──────────────────────────────────────────────────
def get_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def hash_pass(p): return hashlib.sha256(p.encode()).hexdigest()
def row_to_dict(r): return dict(r) if r else None

def init_db():
    conn = get_db()
    conn.execute("""CREATE TABLE IF NOT EXISTS users(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        created_at TEXT DEFAULT (datetime('now')))""")

    conn.execute("""CREATE TABLE IF NOT EXISTS sessions(
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        created_at TEXT DEFAULT (datetime('now')))""")

    conn.execute("""CREATE TABLE IF NOT EXISTS expenses(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        amount REAL NOT NULL,
        type TEXT NOT NULL DEFAULT 'debit',
        category TEXT NOT NULL DEFAULT 'Other',
        description TEXT DEFAULT '',
        added_by TEXT DEFAULT '',
        user_id INTEGER DEFAULT NULL,
        receipt_path TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')))""")

    conn.execute("""CREATE TABLE IF NOT EXISTS user_budgets(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        month TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0,
        note TEXT DEFAULT '',
        UNIQUE(user_id, month))""")

    conn.execute("""CREATE TABLE IF NOT EXISTS categories(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        color TEXT NOT NULL DEFAULT '#94a3b8',
        is_default INTEGER NOT NULL DEFAULT 0)""")

    # Default admin
    if not conn.execute("SELECT id FROM users WHERE username='Admin'").fetchone():
        conn.execute("INSERT INTO users(username,password,role) VALUES(?,?,?)",
                     ("Admin", hash_pass("Admin123"), "admin"))

    # Default categories
    if conn.execute("SELECT COUNT(*) FROM categories").fetchone()[0] == 0:
        conn.executemany("INSERT OR IGNORE INTO categories(name,color,is_default) VALUES(?,?,?)", [
            ("Rent","#60a5fa",1), ("Salary","#4ade80",1), ("Utility","#fbbf24",1),
            ("Internet","#38bdf8",1), ("Supplies","#c084fc",1), ("Food","#f87171",1),
            ("Transport","#34d399",1), ("Other","#94a3b8",1)])

    conn.commit(); conn.close()
    print("✅ DB ready:", DB_PATH)

init_db()

# ── AUTH ────────────────────────────────────────────────
def get_user(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Not logged in")
    token = authorization.split(" ")[1]
    conn = get_db()
    row = conn.execute(
        "SELECT u.* FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token=?",
        (token,)).fetchone()
    conn.close()
    if not row: raise HTTPException(401, "Session expired. Please login again.")
    return dict(row)

def only_admin(user=Depends(get_user)):
    if user["role"] != "admin": raise HTTPException(403, "Admin access required")
    return user

# ── MODELS ──────────────────────────────────────────────
class LoginReq(BaseModel):   username: str; password: str
class UserCreate(BaseModel): username: str; password: str; role: str = "user"
class UserPass(BaseModel):   new_password: str
class BudgetIn(BaseModel):   user_id: int; month: str; amount: float; note: Optional[str] = ""
class CatIn(BaseModel):      name: str; color: Optional[str] = "#94a3b8"

# ── HEALTH ──────────────────────────────────────────────
@app.get("/api/health")
def health(): return {"status": "ok", "version": "1.0"}

# ── AUTH ROUTES ─────────────────────────────────────────
@app.post("/api/auth/login")
def login(req: LoginReq):
    conn = get_db()
    user = conn.execute(
        "SELECT * FROM users WHERE username=? AND password=?",
        (req.username, hash_pass(req.password))).fetchone()
    if not user: conn.close(); raise HTTPException(401, "Wrong username or password")
    user = dict(user); token = secrets.token_hex(32)
    conn.execute("INSERT INTO sessions(token,user_id) VALUES(?,?)", (token, user["id"]))
    conn.commit(); conn.close()
    return {"token": token, "user": {"id": user["id"], "username": user["username"], "role": user["role"]}}

@app.post("/api/auth/logout")
def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        t = authorization.split(" ")[1]
        conn = get_db(); conn.execute("DELETE FROM sessions WHERE token=?", (t,)); conn.commit(); conn.close()
    return {"success": True}

@app.get("/api/auth/me")
def me(user=Depends(get_user)):
    return {"id": user["id"], "username": user["username"], "role": user["role"]}

# ── USERS ────────────────────────────────────────────────
@app.get("/api/users")
def get_users(admin=Depends(only_admin)):
    conn = get_db()
    rows = conn.execute("SELECT id,username,role,created_at FROM users ORDER BY id").fetchall()
    conn.close(); return [row_to_dict(r) for r in rows]

@app.post("/api/users", status_code=201)
def create_user(body: UserCreate, admin=Depends(only_admin)):
    if body.role not in ("admin","user"): raise HTTPException(400, "Role must be admin or user")
    conn = get_db()
    try:
        conn.execute("INSERT INTO users(username,password,role) VALUES(?,?,?)",
                     (body.username.strip(), hash_pass(body.password), body.role))
        conn.commit()
        row = conn.execute("SELECT id,username,role,created_at FROM users WHERE username=?",
                           (body.username,)).fetchone()
        conn.close(); return row_to_dict(row)
    except sqlite3.IntegrityError:
        conn.close(); raise HTTPException(409, f"Username '{body.username}' already exists")

@app.put("/api/users/{uid}/password")
def change_pass(uid: int, body: UserPass, admin=Depends(only_admin)):
    conn = get_db()
    if not conn.execute("SELECT id FROM users WHERE id=?", (uid,)).fetchone():
        conn.close(); raise HTTPException(404, "User not found")
    conn.execute("UPDATE users SET password=? WHERE id=?", (hash_pass(body.new_password), uid))
    conn.commit(); conn.close(); return {"success": True}

@app.delete("/api/users/{uid}")
def del_user(uid: int, admin=Depends(only_admin)):
    conn = get_db()
    u = conn.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    if not u: conn.close(); raise HTTPException(404, "Not found")
    if dict(u)["username"] == "Admin": conn.close(); raise HTTPException(400, "Cannot delete main Admin")
    conn.execute("DELETE FROM sessions WHERE user_id=?", (uid,))
    conn.execute("DELETE FROM users WHERE id=?", (uid,))
    conn.commit(); conn.close(); return {"success": True}

# ── CATEGORIES ───────────────────────────────────────────
@app.get("/api/categories")
def get_cats(user=Depends(get_user)):
    conn = get_db()
    rows = conn.execute("SELECT * FROM categories ORDER BY is_default DESC, name").fetchall()
    conn.close(); return [row_to_dict(r) for r in rows]

@app.post("/api/categories", status_code=201)
def add_cat(cat: CatIn, user=Depends(get_user)):
    name = cat.name.strip()
    if not name: raise HTTPException(400, "Name empty")
    conn = get_db()
    try:
        conn.execute("INSERT INTO categories(name,color,is_default) VALUES(?,?,0)", (name, cat.color))
        conn.commit()
        row = conn.execute("SELECT * FROM categories WHERE name=?", (name,)).fetchone()
        conn.close(); return row_to_dict(row)
    except sqlite3.IntegrityError:
        conn.close(); raise HTTPException(409, f"'{name}' already exists")

@app.delete("/api/categories/{cid}")
def del_cat(cid: int, admin=Depends(only_admin)):
    conn = get_db()
    r = conn.execute("SELECT * FROM categories WHERE id=?", (cid,)).fetchone()
    if not r: conn.close(); raise HTTPException(404, "Not found")
    if dict(r)["is_default"]: conn.close(); raise HTTPException(400, "Cannot delete default category")
    conn.execute("DELETE FROM categories WHERE id=?", (cid,))
    conn.commit(); conn.close(); return {"success": True}

# ── BUDGETS ──────────────────────────────────────────────
@app.get("/api/budget/me/{month}")
def get_my_budget(month: str, user=Depends(get_user)):
    conn = get_db()
    row = conn.execute("SELECT * FROM user_budgets WHERE user_id=? AND month=?",
                       (user["id"], month)).fetchone()
    conn.close()
    return row_to_dict(row) or {"user_id": user["id"], "month": month, "amount": 0, "note": ""}

@app.get("/api/budget/all/{month}")
def get_all_budgets(month: str, admin=Depends(only_admin)):
    conn = get_db()
    users = conn.execute("SELECT id,username FROM users ORDER BY id").fetchall()
    result = []
    for u in users:
        u = dict(u)
        b = conn.execute("SELECT * FROM user_budgets WHERE user_id=? AND month=?",
                         (u["id"], month)).fetchone()
        result.append({"user_id": u["id"], "username": u["username"], "month": month,
                        "amount": dict(b)["amount"] if b else 0,
                        "note": dict(b)["note"] if b else ""})
    conn.close(); return result

@app.post("/api/budget", status_code=201)
def set_budget(b: BudgetIn, admin=Depends(only_admin)):
    conn = get_db()
    if not conn.execute("SELECT id FROM users WHERE id=?", (b.user_id,)).fetchone():
        conn.close(); raise HTTPException(404, "User not found")
    existing = conn.execute("SELECT id FROM user_budgets WHERE user_id=? AND month=?",
                            (b.user_id, b.month)).fetchone()
    if existing:
        conn.execute("UPDATE user_budgets SET amount=?,note=? WHERE user_id=? AND month=?",
                     (b.amount, b.note or "", b.user_id, b.month))
    else:
        conn.execute("INSERT INTO user_budgets(user_id,month,amount,note) VALUES(?,?,?,?)",
                     (b.user_id, b.month, b.amount, b.note or ""))
    conn.commit()
    row = conn.execute("SELECT * FROM user_budgets WHERE user_id=? AND month=?",
                       (b.user_id, b.month)).fetchone()
    conn.close(); return row_to_dict(row)

# ── CARRY FORWARD ────────────────────────────────────────
def calc_carry_forward(conn, up_to_month: str, user_id: int = None, is_admin: bool = False) -> float:
    if is_admin:
        prev = conn.execute(
            "SELECT DISTINCT m FROM (SELECT strftime('%Y-%m',date) as m FROM expenses WHERE strftime('%Y-%m',date)<? UNION SELECT month as m FROM user_budgets WHERE month<?) ORDER BY m",
            (up_to_month, up_to_month)).fetchall()
    else:
        prev = conn.execute(
            "SELECT DISTINCT m FROM (SELECT strftime('%Y-%m',date) as m FROM expenses WHERE strftime('%Y-%m',date)<? AND user_id=? UNION SELECT month as m FROM user_budgets WHERE month<? AND user_id=?) ORDER BY m",
            (up_to_month, user_id, up_to_month, user_id)).fetchall()

    running = 0.0
    for pm in prev:
        m = pm["m"]
        if is_admin:
            pe = conn.execute("SELECT type,amount FROM expenses WHERE strftime('%Y-%m',date)=?",(m,)).fetchall()
            pb = conn.execute("SELECT COALESCE(SUM(amount),0) FROM user_budgets WHERE month=?",(m,)).fetchone()[0]
        else:
            pe = conn.execute("SELECT type,amount FROM expenses WHERE strftime('%Y-%m',date)=? AND user_id=?",(m,user_id)).fetchall()
            pbr = conn.execute("SELECT amount FROM user_budgets WHERE user_id=? AND month=?",(user_id,m)).fetchone()
            pb = pbr[0] if pbr else 0
        running += pb + sum(r["amount"] for r in pe if r["type"]=="credit") - sum(r["amount"] for r in pe if r["type"]=="debit")
    return running

# ── EXPENSES ─────────────────────────────────────────────
@app.get("/api/expenses")
def get_expenses(month: Optional[int]=None, year: Optional[int]=None, user=Depends(get_user)):
    conn = get_db()
    is_admin = user["role"] == "admin"
    if month and year:
        m = str(month).zfill(2)
        if is_admin:
            rows = conn.execute(
                "SELECT * FROM expenses WHERE strftime('%m',date)=? AND strftime('%Y',date)=? ORDER BY date DESC,id DESC",
                (m, str(year))).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM expenses WHERE strftime('%m',date)=? AND strftime('%Y',date)=? AND user_id=? ORDER BY date DESC,id DESC",
                (m, str(year), user["id"])).fetchall()
    else:
        if is_admin:
            rows = conn.execute("SELECT * FROM expenses ORDER BY date DESC,id DESC").fetchall()
        else:
            rows = conn.execute("SELECT * FROM expenses WHERE user_id=? ORDER BY date DESC,id DESC",
                                (user["id"],)).fetchall()
    conn.close(); return [row_to_dict(r) for r in rows]

@app.post("/api/expenses", status_code=201)
async def create_expense(
    date: str = Form(...),
    amount: float = Form(...),
    type: str = Form("debit"),
    category: str = Form("Other"),
    description: str = Form(""),
    receipt: Optional[UploadFile] = File(None),
    user=Depends(get_user)
):
    if type not in ("debit","credit"):
        raise HTTPException(400, "type must be debit or credit")

    # Credit only for admin
    if type == "credit" and user["role"] != "admin":
        raise HTTPException(403, "Only Admin can add credit transactions")

    conn = get_db()
    valid_cats = [r["name"] for r in conn.execute("SELECT name FROM categories").fetchall()]
    if category not in valid_cats:
        conn.close(); raise HTTPException(400, "Invalid category")

    # Handle receipt upload
    receipt_path = ""
    if receipt and receipt.filename:
        ext = os.path.splitext(receipt.filename)[1].lower()
        if ext not in (".jpg",".jpeg",".png",".gif",".webp",".pdf"):
            conn.close(); raise HTTPException(400, "File type not allowed.")
        safe_name = f"{secrets.token_hex(12)}{ext}"
        save_path  = os.path.join(UPLOAD_DIR, safe_name)
        with open(save_path, "wb") as f:
            shutil.copyfileobj(receipt.file, f)
        receipt_path = f"/uploads/{safe_name}"

    cur = conn.execute(
        "INSERT INTO expenses(date,amount,type,category,description,added_by,user_id,receipt_path) VALUES(?,?,?,?,?,?,?,?)",
        (date, amount, type, category, description, user["username"], user["id"], receipt_path))
    conn.commit()
    row = conn.execute("SELECT * FROM expenses WHERE id=?", (cur.lastrowid,)).fetchone()
    conn.close(); return row_to_dict(row)

@app.delete("/api/expenses/{eid}")
def del_expense(eid: int, admin=Depends(only_admin)):
    conn = get_db()
    row = conn.execute("SELECT * FROM expenses WHERE id=?", (eid,)).fetchone()
    if not row: conn.close(); raise HTTPException(404, "Not found")
    r = dict(row)
    if r.get("receipt_path"):
        fp = os.path.join(os.path.dirname(__file__), r["receipt_path"].lstrip("/"))
        if os.path.exists(fp): os.remove(fp)
    conn.execute("DELETE FROM expenses WHERE id=?", (eid,))
    conn.commit(); conn.close(); return {"success": True}

# ── SUMMARY ──────────────────────────────────────────────
@app.get("/api/summary/{month}")
def get_summary(month: str, user=Depends(get_user)):
    conn = get_db()
    is_admin = user["role"] == "admin"

    if is_admin:
        rows = conn.execute(
            "SELECT * FROM expenses WHERE strftime('%Y-%m',date)=? ORDER BY date DESC,id DESC",
            (month,)).fetchall()
        budget = conn.execute(
            "SELECT COALESCE(SUM(amount),0) FROM user_budgets WHERE month=?", (month,)).fetchone()[0]
        carry_forward = calc_carry_forward(conn, month, is_admin=True)
    else:
        rows = conn.execute(
            "SELECT * FROM expenses WHERE strftime('%Y-%m',date)=? AND user_id=? ORDER BY date DESC,id DESC",
            (month, user["id"])).fetchall()
        b_row = conn.execute("SELECT * FROM user_budgets WHERE user_id=? AND month=?",
                             (user["id"], month)).fetchone()
        budget = dict(b_row)["amount"] if b_row else 0
        carry_forward = calc_carry_forward(conn, month, user_id=user["id"], is_admin=False)

    conn.close()
    expenses = [row_to_dict(r) for r in rows]
    td = sum(e["amount"] for e in expenses if e["type"]=="debit")
    tc = sum(e["amount"] for e in expenses if e["type"]=="credit")
    this_month = budget + tc - td
    total = carry_forward + this_month

    cats = {}
    for e in expenses:
        k = e["category"]
        if k not in cats: cats[k] = {"debit":0,"credit":0}
        cats[k][e["type"]] += e["amount"]

    return {
        "month": month, "budget": budget,
        "total_credit": tc, "total_debit": td,
        "this_month_balance": this_month,
        "carry_forward": carry_forward,
        "total_balance": total,
        "balance": this_month,
        "categories": cats, "expenses": expenses, "is_admin": is_admin
    }

# ── WEEKLY SUMMARY ───────────────────────────────────────
@app.get("/api/summary/week/{date}")
def get_weekly(date: str, user=Depends(get_user)):
    from datetime import timedelta
    dt = datetime.strptime(date, "%Y-%m-%d")
    ws = (dt - timedelta(days=dt.weekday())).strftime("%Y-%m-%d")
    we = (dt - timedelta(days=dt.weekday()) + timedelta(days=6)).strftime("%Y-%m-%d")
    conn = get_db()
    is_admin = user["role"] == "admin"
    if is_admin:
        rows = conn.execute("SELECT * FROM expenses WHERE date>=? AND date<=? ORDER BY date DESC",(ws,we)).fetchall()
    else:
        rows = conn.execute("SELECT * FROM expenses WHERE date>=? AND date<=? AND user_id=? ORDER BY date DESC",(ws,we,user["id"])).fetchall()
    conn.close()
    expenses = [row_to_dict(r) for r in rows]
    td = sum(e["amount"] for e in expenses if e["type"]=="debit")
    tc = sum(e["amount"] for e in expenses if e["type"]=="credit")
    return {"period": f"{ws} to {we}", "type":"weekly","total_debit":td,"total_credit":tc,"balance":tc-td,"expenses":expenses}

# ── YEARLY SUMMARY ───────────────────────────────────────
@app.get("/api/summary/year/{year}")
def get_yearly(year: int, user=Depends(get_user)):
    conn = get_db()
    is_admin = user["role"] == "admin"
    if is_admin:
        rows = conn.execute("SELECT * FROM expenses WHERE strftime('%Y',date)=? ORDER BY date DESC",(str(year),)).fetchall()
        budget = conn.execute("SELECT COALESCE(SUM(amount),0) FROM user_budgets WHERE month LIKE ?",(f"{year}-%",)).fetchone()[0]
    else:
        rows = conn.execute("SELECT * FROM expenses WHERE strftime('%Y',date)=? AND user_id=? ORDER BY date DESC",(str(year),user["id"])).fetchall()
        budget = conn.execute("SELECT COALESCE(SUM(amount),0) FROM user_budgets WHERE user_id=? AND month LIKE ?",(user["id"],f"{year}-%")).fetchone()[0] or 0
    conn.close()
    expenses = [row_to_dict(r) for r in rows]
    td = sum(e["amount"] for e in expenses if e["type"]=="debit")
    tc = sum(e["amount"] for e in expenses if e["type"]=="credit")
    return {"period":str(year),"type":"yearly","budget":budget,"total_debit":td,"total_credit":tc,"balance":budget+tc-td,"expenses":expenses}

# ── PDF EXPORT ───────────────────────────────────────────
from pdf_export import router as pdf_router
app.include_router(pdf_router)
