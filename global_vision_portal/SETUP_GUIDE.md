# Global Vision Portal - Setup & Usage Guide

## 🎯 Quick Start

### For Demo (No Backend Required)
1. Open `frontend/login.html` in a web browser
2. Use any test credentials with demo email (see below)
3. System works with mock data stored locally

### For Production (With Backend)
1. Execute SQL Server schema setup
2. Set up Node.js backend
3. Configure API endpoints
4. Deploy frontend to web server

---

## 📋 Test Credentials (Demo Mode)

| Email | Password | Role |
|-------|----------|------|
| admin@globalvision.com | any | Admin |
| john@globalvision.com | any | Manager |
| alice@globalvision.com | any | Employee |
| bob@globalvision.com | any | Employee |

**Note**: Password validation is skipped in demo mode for testing.

---

## 🗄️ Database Setup

### Windows / SQL Server

1. Open **SQL Server Management Studio (SSMS)**
2. Connect to your SQL Server instance
3. Right-click on "Databases" → New Database
4. Name: `GlobalVisionPortal`
5. Open `database/schema.sql` file
6. Execute the script

### Verification
```sql
USE GlobalVisionPortal;
SELECT * FROM Employees;
SELECT * FROM Attendance;
SELECT * FROM Inventory;
SELECT * FROM Tasks;
SELECT * FROM KnowledgeBase;
```

---

## 🖥️ Running the Application

### Option A: Frontend Only (Easiest)
```bash
# VS Code with Live Server extension
- Install "Live Server" extension
- Right-click on login.html → "Open with Live Server"
- Browser opens at http://localhost:5500/login.html
```

### Option B: Using Python
```bash
cd d:\websites\global_vision_portal\frontend
python -m http.server 8000
# Visit http://localhost:8000/login.html
```

### Option C: Using Node.js HTTP Server
```bash
npm install -g http-server
cd d:\websites\global_vision_portal\frontend
http-server
# Visit http://localhost:8080
```

### Option D: Backend with Node.js
```bash
# Terminal 1 - Backend
cd d:\websites\global_vision_portal\backend
npm install
npm start

# Terminal 2 - Frontend (separate command)
cd d:\websites\global_vision_portal\frontend
http-server
```

---

## 📱 Module Features

### 1. Attendance Module
- **Feature**: One-click login/logout
- **Data Stored**: Date, Login Time, Logout Time
- **Display**: Dashboard shows status and monthly hours

**How to Test**:
1. Login to portal
2. Click "Login/Logout" button on dashboard
3. Check status updates

---

### 2. Profile Module
- **Feature**: View and edit employee profile
- **Editable**: Name, Contact Number
- **Read-only**: Email, Department, Role
- **Password**: Change password with validation

**How to Test**:
1. Navigate to Profile page
2. Edit Name or Contact
3. Click "Save Changes"
4. Try changing password

---

### 3. Tasks Module
- **Feature**: View assigned tasks
- **Filters**: Status, Priority
- **Actions**: Update task status
- **Display**: Task cards with deadline

**How to Test**:
1. Go to Tasks page
2. Filter by status or priority
3. Click on a task to view details
4. Update status and save

---

### 4. Inventory Module
- **Feature**: Request and return items
- **Actions**: Request available items, return issued items
- **Display**: Item name, quantity, issue date, status

**How to Test**:
1. Go to Inventory page
2. Click "Request" to request an available item
3. Click "Return" on issued items
4. Fill in return date and submit

---

### 5. Knowledge Base Module
- **Feature**: Searchable FAQ/solutions
- **Filters**: Category, Full-text search
- **Display**: Problem, solution, author, view count

**How to Test**:
1. Go to Knowledge Base page
2. Search for keywords (e.g., "password")
3. Filter by category
4. Click on article to view details

---

## 🗂️ File Organization

```
Frontend Files:
├── login.html              → Entry point
├── dashboard.html          → Main dashboard
├── profile.html            → Profile management
├── tasks.html              → Task management
├── inventory.html          → Inventory tracking
├── knowledge-base.html     → Knowledge base search
├── css/style.css           → All styling (responsive)
└── js/
    ├── common.js           → Shared functions & mock data
    ├── login.js            → Login authentication
    ├── dashboard.js        → Dashboard data
    ├── profile.js          → Profile management
    ├── tasks.js            → Task operations
    ├── inventory.js        → Inventory operations
    └── knowledge-base.js   → KB search & display

Backend Files:
├── server.js               → Express server (template)
├── package.json            → Dependencies
└── config.md               → Backend setup

Database Files:
└── schema.sql              → SQL Server script
```

---

## 🔍 Troubleshooting

### Issue: Pages not loading

**Solution**:
1. Check browser console (F12)
2. Ensure file paths are correct
3. Try opening in incognito/private mode
4. Clear browser cache

### Issue: Login not working

**Solution**:
1. Verify email matches test credentials
2. Check if localStorage is enabled
3. Look for errors in console (F12)
4. Try different email from test list

### Issue: Data not persisting

**Solution**:
1. Demo mode uses localStorage (session-based)
2. Data clears when browser cache is cleared
3. For persistent data, implement backend

### Issue: Styling issues

**Solution**:
1. Ensure css/style.css is loaded
2. Check browser zoom level (Ctrl+0 to reset)
3. Try different browser
4. Check responsive design on mobile

---

## 📊 Mock Data Included

### Sample Employees
- Admin User (admin@globalvision.com)
- John Manager (john@globalvision.com)
- Alice Employee (alice@globalvision.com)
- Bob Employee (bob@globalvision.com)

### Sample Tasks
- Complete Project Report (Alice, High Priority)
- Update Inventory List (Bob, Medium Priority)
- Client Meeting Preparation (Alice, High Priority)

### Sample Inventory
- Laptop (5 units, available)
- Monitor (10 units, 2 issued)
- Mouse (20 units, 2 issued)
- Keyboard (15 units, available)

### Sample KB Articles
- How to reset password?
- VPN Connection Issues
- How to request leave?
- System is running slow

---

## 🎨 Responsive Design

The portal is fully responsive:

| Screen Size | Behavior |
|-------------|----------|
| 480px - 768px | Mobile optimization |
| 768px - 1024px | Tablet layout |
| 1024px+ | Desktop full layout |

---

## ✅ Deployment Checklist

- [ ] Database schema created in SQL Server
- [ ] Backend API running (if using)
- [ ] Frontend API URL updated in common.js
- [ ] SSL certificate configured (production)
- [ ] Database backups scheduled
- [ ] Error logging implemented
- [ ] Performance monitoring set up
- [ ] Security headers configured
- [ ] CORS properly configured
- [ ] User roles and permissions verified

---

## 📞 Common Questions

**Q: Can I use this without a backend?**
A: Yes! The demo mode uses mock data stored in localStorage.

**Q: How do I add more employees?**
A: Add SQL INSERT statements to schema.sql or use admin panel (to be implemented).

**Q: Is this mobile-friendly?**
A: Yes, fully responsive CSS with mobile-first design.

**Q: Can I customize the colors?**
A: Yes, edit CSS variables at top of style.css.

**Q: How do I add new modules?**
A: Create new HTML file, add to navigation, create corresponding JS logic.

---

**Last Updated**: May 25, 2026
**Version**: 1.0.0
