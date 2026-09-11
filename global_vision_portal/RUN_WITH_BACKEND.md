# 🚀 Run Portal with Backend - Complete Guide

## 📋 Prerequisites Check

✅ Node.js 14+ installed?
✅ SQL Server running?
✅ Database schema executed?

---

## 🎯 3-Step Setup

### Step 1️⃣: Backend Setup (Terminal 1)

```bash
# Navigate to backend folder
cd d:\websites\global_vision_portal\backend

# Install dependencies
npm install

# This installs:
# - express (server framework)
# - mssql (database driver)
# - jsonwebtoken (JWT auth)
# - bcryptjs (password hashing)
# - dotenv (configuration)
# - cors (cross-origin)
# - helmet (security)
```

**Expected Output:**
```
added XX packages in Xs
```

---

### Step 2️⃣: Configure Database Connection

Create `.env` file in `backend` folder with your database details:

```
PORT=3000
NODE_ENV=development

# Database
DB_SERVER=localhost
DB_NAME=GlobalVisionPortal
DB_USER=sa
DB_PASSWORD=YourSQLPassword

# JWT
JWT_SECRET=your-secret-key-change-this
JWT_EXPIRE=7d

# CORS
CORS_ORIGIN=http://localhost:5500
```

**Replace:**
- `YourSQLPassword` → Your actual SQL Server password
- `your-secret-key-change-this` → Any random string

---

### Step 3️⃣: Start Backend Server (Terminal 1)

```bash
# Still in d:\websites\global_vision_portal\backend

npm start

# Expected output:
# ✅ Server running on http://localhost:3000
# ✅ Database connected successfully
```

---

## 🌐 Step 4: Start Frontend Server (Terminal 2 - NEW)

**Open a NEW command prompt/terminal:**

```bash
# Navigate to frontend folder
cd d:\websites\global_vision_portal\frontend

# Option A: Python HTTP Server
python -m http.server 5500

# Option B: Node HTTP Server
npx http-server -p 5500

# Option C: Live Server (VS Code)
# Right-click login.html → Open with Live Server
```

**Expected Output:**
```
Serving HTTP on port 5500...
```

---

## 🔗 Update Frontend API Connection

Edit `frontend/js/common.js` line ~3:

**Find this:**
```javascript
const API_BASE_URL = 'http://localhost:3000/api';
```

**Make sure it matches** (it should already be correct):
```javascript
const API_BASE_URL = 'http://localhost:3000/api';
```

---

## ✅ Verify Everything is Running

### Check Backend
```
http://localhost:3000/api/health
```
Should return:
```json
{"status":"OK","message":"Server is running"}
```

### Check Frontend
```
http://localhost:5500/login.html
```
Should load the login page

---

## 📊 Terminal Layout

You should have **2 terminals open**:

```
Terminal 1 (Backend)              Terminal 2 (Frontend)
───────────────────              ──────────────────
cd backend                       cd frontend
npm start                        python -m http.server 5500
↓                                ↓
Server on :3000 ✅              Server on :5500 ✅
Database connected ✅            Serving frontend ✅
```

---

## 🎮 Test the Application

1. **Open Browser**: http://localhost:5500/login.html

2. **Login with test account**:
   ```
   Email: alice@globalvision.com
   Password: any value
   ```

3. **Check Browser Console** (F12):
   - Should see API calls to `http://localhost:3000/api/...`
   - Should see success responses ✅
   - No CORS errors

4. **Test Each Feature**:
   - ✅ Dashboard - Login/Logout button
   - ✅ Profile - Edit and save
   - ✅ Tasks - Filter and update
   - ✅ Inventory - Request/return items
   - ✅ Knowledge Base - Search

---

## ⚠️ Common Issues & Solutions

### Issue: Port 3000 Already in Use
```bash
# Find what's using port 3000
netstat -ano | findstr :3000

# Kill the process
taskkill /PID <PID> /F

# Or use different port:
# Edit server.js or .env to use PORT=3001
```

### Issue: Database Connection Failed
```
Error: Connection refused

Solution:
1. Check SQL Server is running (Services → SQL Server)
2. Verify credentials in .env file
3. Check database GlobalVisionPortal exists
4. Run: sqlcmd -S localhost -U sa -P YourPassword
```

### Issue: CORS Error in Browser
```
Error: Access to XMLHttpRequest blocked by CORS policy

Solution:
1. Check CORS_ORIGIN in .env matches frontend URL
2. Add to .env: CORS_ORIGIN=http://localhost:5500
3. Restart backend (npm start)
```

### Issue: Frontend Can't Reach Backend
```
Error: Failed to fetch from API

Solution:
1. Backend must be running on port 3000
2. Frontend must call http://localhost:3000/api
3. Check both servers are running
4. Look at Network tab in F12 dev tools
```

---

## 🔄 Workflow Summary

```
User Opens Browser
        ↓
Frontend loads from :5500 ✅
        ↓
User clicks Login
        ↓
Frontend sends POST to :3000/api/auth/login ✅
        ↓
Backend queries SQL Server ✅
        ↓
Backend returns token + user data ✅
        ↓
Frontend stores token and redirects ✅
        ↓
User sees dashboard ✅
```

---

## 📁 File Structure Running

```
During Execution:
─────────────────────────────────────────
Backend (Terminal 1)
  Server: http://localhost:3000
  Database: GlobalVisionPortal
  Status: ✅ Running

Frontend (Terminal 2)
  Server: http://localhost:5500
  Files: Served from frontend/
  Status: ✅ Running

Browser
  URL: http://localhost:5500/login.html
  API: http://localhost:3000/api
  Status: ✅ Connected
─────────────────────────────────────────
```

---

## 🎯 Next Steps After Starting

1. **Monitor Console Output**
   ```
   Backend console: API calls logged
   Frontend console (F12): See requests/responses
   ```

2. **Test Each Module**
   - Attendance (login/logout)
   - Profile (update)
   - Tasks (filter/update)
   - Inventory (request/return)
   - Knowledge Base (search)

3. **Check Network Tab** (F12 → Network)
   - See all API calls
   - Verify 200 OK responses
   - Check response data

4. **Monitor Backend** (Terminal 1)
   - Should show incoming requests
   - Should show database queries
   - Should show any errors

---

## 🛑 Stopping Servers

### Stop Backend (Terminal 1)
```bash
Press Ctrl + C
```

### Stop Frontend (Terminal 2)
```bash
Press Ctrl + C
```

### Restart Both
```bash
# Terminal 1
cd d:\websites\global_vision_portal\backend
npm start

# Terminal 2 (new)
cd d:\websites\global_vision_portal\frontend
python -m http.server 5500
```

---

## 📊 Environment Variables Explained

In `.env` file:

```
# Server port
PORT=3000

# Environment
NODE_ENV=development

# Database connection
DB_SERVER=localhost          # Your SQL Server name
DB_NAME=GlobalVisionPortal   # Database name
DB_USER=sa                   # SQL Server user
DB_PASSWORD=YourPassword     # SQL Server password

# Security
JWT_SECRET=my-secret-key     # Random key for tokens
JWT_EXPIRE=7d                # Token expiration

# CORS (security)
CORS_ORIGIN=http://localhost:5500  # Frontend URL
```

---

## ✅ Success Indicators

When everything is running correctly:

```
✅ Backend console shows: "Database connected successfully"
✅ Frontend loads without errors
✅ Login works with test credentials
✅ API calls show in Network tab
✅ No CORS errors in console
✅ Dashboard displays attendance status
✅ All features functional
```

---

## 🎓 Learning Tips

1. **Watch the console** while testing features
2. **Check Network tab** (F12) to see actual API calls
3. **Read backend logs** to see database queries
4. **Use debugger** (F12) to trace JavaScript
5. **Test thoroughly** before deploying

---

**Ready to go! Follow the 4 steps above and your portal will be running with backend! 🚀**
