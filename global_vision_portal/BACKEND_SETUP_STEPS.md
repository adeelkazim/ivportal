# 🚀 Complete Setup - Run Portal with Backend

## ✅ Current Status

✅ **Backend installed** (npm packages ready)
✅ **Backend configured** (.env file created)
❌ **SQL Server not running** (needs to be started)
⏳ **Frontend ready** (waiting for backend)

---

## 🔧 STEP 1: Start SQL Server Service

### Option A: Start SQL Server (Windows Services)

1. Press **Windows Key + R**
2. Type: `services.msc`
3. Look for **"SQL Server (SQLEXPRESS)"** or **"SQL Server"**
4. Right-click → **Start**
5. Wait 10-20 seconds for it to start

### Option B: Start SQL Server from SQL Server Configuration Manager

1. Press **Windows Key + R**
2. Type: `SQLServerManager15` (or 16, 17 depending on version)
3. Expand **SQL Server Services**
4. Right-click **SQL Server** → **Start**

### Option C: Check if Already Running

Open Command Prompt and run:
```
sqlcmd -S localhost -U sa -P sa
```

If you see `1>` prompt, SQL Server is running ✅

---

## 📊 STEP 2: Create the Database

Once SQL Server is running:

1. Open **SQL Server Management Studio (SSMS)**
2. Connect with:
   - Server: `localhost`
   - Auth: Windows Authentication
   
3. Open **New Query** (Ctrl+N)
4. Copy & paste contents of: `database/schema.sql`
5. Click **Execute** (F5)
6. You should see: **"Commands completed successfully"** ✅

---

## ▶️ STEP 3: Start Backend Again

The backend is already loaded. Just run:

```bash
# Terminal is ready, just type:
node server.js
```

**Expected output:**
```
✅ Server running on http://localhost:3000
✅ Database connected successfully
```

---

## 🌐 STEP 4: Start Frontend (NEW Terminal)

Open a **NEW command prompt/PowerShell**:

```bash
cd d:\websites\global_vision_portal\frontend

# Option A: Python
python -m http.server 5500

# Option B: Node HTTP Server
npx http-server -p 5500
```

**Expected output:**
```
Serving HTTP on port 5500
```

---

## 🎮 STEP 5: Test the Application

1. Open Browser: `http://localhost:5500/login.html`

2. Login with:
   ```
   Email: alice@globalvision.com
   Password: (any value)
   ```

3. Check **Developer Console** (F12):
   - Should see API calls to `http://localhost:3000/api`
   - Should see 200 OK responses ✅
   - NO CORS errors

---

## 📋 Troubleshooting

### Problem: "Failed to connect to localhost:1433"

**Solution:**
```
1. Open Windows Services (services.msc)
2. Find "SQL Server (SQLEXPRESS)" 
3. Right-click → Start
4. Restart backend (node server.js)
```

### Problem: "Connection timeout"

**Solution:**
```
1. Verify SQL Server is running
2. Check database exists (GlobalVisionPortal)
3. Try: sqlcmd -S localhost -U sa -P sa
4. Verify .env has correct credentials
```

### Problem: CORS errors in browser

**Solution:**
```
1. Check frontend URL: http://localhost:5500
2. Backend API URL: http://localhost:3000/api
3. Both must be running
4. Restart backend
```

### Problem: "Database not found"

**Solution:**
```
1. Open SSMS
2. Run: database/schema.sql
3. Verify GlobalVisionPortal appears in database list
4. Restart backend
```

---

## 🎯 Complete Terminal Setup

When everything is working:

```
TERMINAL 1 (Backend)          TERMINAL 2 (Frontend)
──────────────────────        ───────────────────
d:\...\backend>               d:\...\frontend>
node server.js                python -m http.server 5500
↓                             ↓
:3000 ✅                      :5500 ✅
DB Connected ✅               Files Served ✅
API Ready ✅                  Browser Ready ✅

BROWSER
───────
http://localhost:5500/login.html
Connected to :3000 API ✅
All Features Working ✅
```

---

## 📊 Quick Checklist

- [ ] SQL Server service started
- [ ] Database created (schema.sql executed)
- [ ] Backend running on :3000
- [ ] Frontend running on :5500
- [ ] Can login to portal
- [ ] Dashboard loads
- [ ] No console errors
- [ ] API calls working

---

## 🎓 Next Steps

1. **Verify SQL Server is running** (Windows Services)
2. **Create database** (execute schema.sql in SSMS)
3. **Restart backend** (node server.js)
4. **Start frontend** (python -m http.server 5500 in new terminal)
5. **Test login** (http://localhost:5500/login.html)

---

**Your backend attempted to start but couldn't find SQL Server. Follow the steps above to get SQL Server running, then the backend will connect automatically! 🚀**
