# SQL Server (SSMS) Setup

## Connection (matches your SSMS dialog)

| Setting | Value |
|---------|--------|
| Server | `(localdb)\MSSQLLocalDB` |
| Authentication | Windows Authentication |
| Database | `GlobalVisionPortal` |
| Encrypt | Yes |
| Trust Server Certificate | Yes (required for LocalDB with Node ODBC) |

**Connection string (SSMS → Connect → Connection String tab):**

```
Server=(localdb)\MSSQLLocalDB;Database=GlobalVisionPortal;Integrated Security=True;Encrypt=True;TrustServerCertificate=True;
```

## One-time setup

```powershell
# 1. Start LocalDB (if needed)
sqllocaldb start MSSQLLocalDB

# 2. Create database, tables, and demo users
cd backend
npm install
npm run init-db

# 3. Start API
npm start
```

## Demo logins

All use password: **password123**

- `admin@globalvision.com` (Admin)
- `john@globalvision.com` (Manager)
- `alice@globalvision.com` (Employee)
- `bob@globalvision.com` (Employee)

## Run the website

1. Keep the backend running on `http://localhost:3000`
2. Open `frontend/login.html` with Live Server (or any static server on port 5500+)
3. Log in — all modules use the live database

## Verify in SSMS

Connect with the settings above, expand **GlobalVisionPortal** → Tables. You should see `Employees`, `Attendance`, `Inventory`, `KnowledgeBase`, `Tasks`.

## Troubleshooting

- **Database unavailable (503):** Run `npm run init-db` and ensure LocalDB is running.
- **Login fails:** Run `npm run init-db` again to reset bcrypt passwords.
- **ODBC errors:** Install [ODBC Driver 18 for SQL Server](https://learn.microsoft.com/en-us/sql/connect/odbc/download-odbc-driver-for-sql-server) or set `ODBC_DRIVER=ODBC Driver 17 for SQL Server` in `backend/.env`.
