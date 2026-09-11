# How to Connect to SSMS (SQL Server Management Studio)

## 📋 Prerequisites

1. **SQL Server installed** (2019 or later)
2. **SSMS installed** (free download from Microsoft)
3. **Database schema file ready**: `database/schema.sql`

---

## 🚀 Step-by-Step Connection Guide

### Step 1: Open SSMS

1. Click **Start Menu** (Windows)
2. Search for **"SQL Server Management Studio"**
3. Click to open
4. Wait for SSMS to load (first launch takes ~30 seconds)

### Step 2: Connect to Your SQL Server

When SSMS opens, you'll see the **"Connect to Server"** dialog:

```
┌─────────────────────────────────────┐
│   Connect to Server                 │
├─────────────────────────────────────┤
│ Server type:  Database Engine    ▼ │
│ Server name:  [  localhost          │
│ Auth:         Windows Authentication│
│ Login:        [  your-username      │
│ Password:     [  ••••••••••••       │
│                                     │
│ [Connect]  [Cancel]  [Help]         │
└─────────────────────────────────────┘
```

**For Local SQL Server:**
- **Server name**: `localhost` or `(local)` or `.\SQLEXPRESS`
- **Authentication**: Windows Authentication (default)
- Click **Connect**

**For Named Instance:**
- **Server name**: `COMPUTERNAME\INSTANCENAME`
- Example: `DESKTOP-ABC123\SQLSERVER2019`

### Step 3: Verify Connection

After clicking Connect:
- ✅ Right side shows "Object Explorer"
- ✅ See your server listed
- ✅ Expand to see existing databases

---

## 📁 Method 1: Import Schema Using Query Editor

### 1. Open New Query
```
File → New → Query with Current Connection
(Or press Ctrl + N)
```

### 2. Open Schema File
```
File → Open → File
Navigate to: d:\websites\global_vision_portal\database\schema.sql
Click Open
```

### 3. Execute Script
```
Click "Execute" button (or press F5)
```

### 4. Verify
In **Object Explorer**, right-click on **Databases** → Refresh

You should see **"GlobalVisionPortal"** database created ✅

---

## 📁 Method 2: Direct Query Copy-Paste

### 1. Open the Schema File
```
Open: d:\websites\global_vision_portal\database\schema.sql
(With any text editor: Notepad, VS Code, etc.)
```

### 2. Copy All Content
```
Select All (Ctrl + A)
Copy (Ctrl + C)
```

### 3. In SSMS - New Query
```
Press Ctrl + N (new query window)
Paste the script (Ctrl + V)
```

### 4. Execute
```
Press F5 or click "Execute" button
```

### 5. Check Success
In **Output window**, you should see:
```
Commands completed successfully.
```

---

## 🔍 Verify Database Creation

### Check Database Exists
1. **Object Explorer** (left side)
2. Expand **Databases** folder
3. Look for **GlobalVisionPortal** ✅

### Verify Tables
1. Expand **GlobalVisionPortal**
2. Expand **Tables**
3. You should see:
   - ✅ dbo.Employees
   - ✅ dbo.Attendance
   - ✅ dbo.Tasks
   - ✅ dbo.Inventory
   - ✅ dbo.KnowledgeBase

### View Sample Data
```sql
-- In new query window, run:
USE GlobalVisionPortal;
SELECT * FROM Employees;
SELECT * FROM Tasks;
SELECT * FROM Inventory;
SELECT * FROM KnowledgeBase;
```

---

## ⚠️ Troubleshooting Connection Issues

### Issue: "Cannot Connect to Server"

**Solution 1: Wrong Server Name**
```
Try these names:
- localhost
- (local)
- .\SQLEXPRESS
- 127.0.0.1
- Your actual computer name
```

**Solution 2: SQL Server Not Running**
```
Windows + R → services.msc
Look for "SQL Server (SQLEXPRESS)"
Right-click → Start
```

**Solution 3: Wrong Authentication**
```
Try:
- Windows Authentication (default)
- SQL Server Authentication (if Windows doesn't work)
```

### Issue: "Database Already Exists"

**Solution:**
```sql
-- Drop existing database first:
DROP DATABASE GlobalVisionPortal;

-- Then run schema.sql again
```

### Issue: Permission Denied

**Solution:**
```
1. Run SSMS as Administrator
2. Right-click SSMS → "Run as administrator"
3. Try connecting again
```

---

## 🎯 Quick Connection Checklist

- [ ] SSMS is open
- [ ] Connected to SQL Server (green checkmark on server name)
- [ ] Server name shows correctly
- [ ] Can expand "Databases" in Object Explorer
- [ ] schema.sql file located
- [ ] Executed schema.sql without errors
- [ ] Can see GlobalVisionPortal database
- [ ] Can see 5 tables in database

---

## 📊 Connection Test Query

After successful connection, run this query to test:

```sql
USE GlobalVisionPortal;

-- Should return 4 employees
SELECT COUNT(*) as EmployeeCount FROM Employees;

-- Should return 4 inventory items
SELECT COUNT(*) as ItemCount FROM Inventory;

-- Should return 3 tasks
SELECT COUNT(*) as TaskCount FROM Tasks;

-- Should return 4 KB articles
SELECT COUNT(*) as KBCount FROM KnowledgeBase;
```

**Expected Output:**
```
EmployeeCount: 4
ItemCount: 4
TaskCount: 3
KBCount: 4
```

---

## 🔐 Connection String (For Backend)

After successful SSMS connection, use this in your backend `.env` file:

```
DB_SERVER=localhost
DB_NAME=GlobalVisionPortal
DB_USER=sa
DB_PASSWORD=YourPassword123
```

Or for Windows Authentication:
```
DB_SERVER=localhost
DB_NAME=GlobalVisionPortal
DB_TRUSTED_CONNECTION=true
```

---

## 📸 Screenshots

### SSMS Main Window
```
┌─────────────────────────────────────────────────┐
│ SQL Server Management Studio                    │
├─────────────────────────────────────────────────┤
│ [File] [Edit] [View] [Query] [Tools] [Help]    │
│                                                 │
│ Object Explorer          Query Window           │
│ ├─ Databases             USE GlobalVisionPortal;│
│ │  ├─ GlobalVisionPortal SELECT * FROM Empl... │
│ │  │  ├─ Tables                                │
│ │  │  │  ├─ Employees  [Execute] ▶ F5         │
│ │  │  │  ├─ Attendance                         │
│ │  │  │  ├─ Tasks                              │
│ │  │  │  ├─ Inventory                          │
│ │  │  │  └─ KnowledgeBase                      │
│ │  │  └─ Views                                 │
│ │  └─ [other databases]                        │
│ └─ Security                                     │
└─────────────────────────────────────────────────┘
```

---

## ✅ Next Steps After Connection

1. ✅ Verify all 5 tables created
2. ✅ Run test query to confirm data
3. ✅ Check employee records
4. ✅ Set up backend connection string
5. ✅ Start Node.js backend
6. ✅ Update frontend API URL
7. ✅ Test full application flow

---

## 📞 Quick Reference

| Task | Command |
|------|---------|
| New Query | `Ctrl + N` |
| Execute Query | `F5` |
| Refresh | `F5` on Object Explorer |
| Connect | From initial dialog |
| Disconnect | Disconnect option in menu |
| Database Info | `EXEC sp_databases` |

---

**Still Need Help?** Check your browser console (F12) for any API errors after backend setup!

---

**Last Updated**: May 25, 2026
**SSMS Version**: Tested with SQL Server 2019+
