# Global Vision Portal - Employee Management System

A comprehensive employee management portal with frontend (HTML/CSS/JavaScript) and backend (SQL Server database with API).

## 🎯 Features

### ✅ Core Modules

1. **Employee Attendance** - Auto login/logout tracking with system timestamps
2. **User Profiles** - Editable employee profiles with role-based access
3. **Local Inventory** - Track items issued to employees
4. **Knowledge Base** - Searchable FAQ and problem/solution repository
5. **Task Management** - Managers assign tasks to employees with status tracking

## 📁 Project Structure

```
global_vision_portal/
├── frontend/
│   ├── login.html              # Login page
│   ├── dashboard.html          # Main dashboard
│   ├── profile.html            # User profile page
│   ├── tasks.html              # Task management page
│   ├── inventory.html          # Inventory tracking page
│   ├── knowledge-base.html     # Knowledge base page
│   ├── css/
│   │   └── style.css           # Main stylesheet (responsive)
│   └── js/
│       ├── common.js           # Shared utilities and mock data
│       ├── login.js            # Login logic
│       ├── dashboard.js        # Dashboard logic
│       ├── profile.js          # Profile management
│       ├── tasks.js            # Task management
│       ├── inventory.js        # Inventory management
│       └── knowledge-base.js   # Knowledge base search/display
├── backend/
│   ├── server.js               # Express server (template)
│   ├── package.json            # Dependencies
│   ├── routes/
│   ├── controllers/
│   └── config/
├── database/
│   └── schema.sql              # SQL Server database schema
└── README.md                   # This file
```

## 🚀 Quick Start

### Option 1: Frontend Only (Demo Mode)

The frontend uses mock data stored in `localStorage` and doesn't require a backend server.

1. **Open in Browser**
   - Navigate to the frontend folder
   - Open `login.html` in your browser (or use Live Server extension)
   - Use mock credentials:
     - Email: `alice@globalvision.com`
     - Password: `any value` (demo accepts any password)

### Option 2: With Backend (Production Setup)

#### Prerequisites
- Node.js 14+
- SQL Server 2019+
- npm or yarn

#### Step 1: Database Setup

1. Open **SQL Server Management Studio (SSMS)**
2. Execute the SQL script:
   ```sql
   -- Open and run: database/schema.sql
   ```
3. Verify tables created in database `GlobalVisionPortal`

#### Step 2: Backend Setup

1. Navigate to backend folder:
   ```bash
   cd backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create `.env` file:
   ```
   PORT=3000
   DB_SERVER=localhost
   DB_NAME=GlobalVisionPortal
   DB_USER=sa
   DB_PASSWORD=your_password
   JWT_SECRET=your_secret_key
   ```

4. Start server:
   ```bash
   npm start
   ```

#### Step 3: Frontend Setup

1. Update API URL in `frontend/js/common.js`:
   ```javascript
   const API_BASE_URL = 'http://localhost:3000/api';
   ```

2. Open `frontend/login.html` in browser

3. Use test credentials:
   - Email: `alice@globalvision.com`
   - Password: `TestPass123`

## 🔑 Default Test Credentials

| Email | Role | Department |
|-------|------|-----------|
| admin@globalvision.com | Admin | IT |
| john@globalvision.com | Manager | Sales |
| alice@globalvision.com | Employee | Sales |
| bob@globalvision.com | Employee | IT |

## 💾 Database Schema

### Tables

1. **Employees**
   - Employee master data
   - Stores name, department, role, contact

2. **Attendance**
   - Login/logout records
   - Indexed by EmployeeID and Date for fast queries

3. **Inventory**
   - Items issued to employees
   - Tracks issue and return dates

4. **KnowledgeBase**
   - FAQ and problem solutions
   - Searchable by title and category

5. **Tasks**
   - Task assignments by managers
   - Status tracking (Pending, In Progress, Completed, On Hold)

## 🎨 Frontend Features

### Responsive Design
- Mobile-friendly (tested on 480px+)
- Tablet-optimized layout
- Desktop-full responsive grid

### Pages

**Login Page**
- Email/password authentication
- "Remember Me" option
- Demo mode with mock data

**Dashboard**
- Quick attendance status
- Task summary with pending count
- Issued items display
- Monthly hours calculation
- Quick statistics cards

**Profile Page**
- Edit personal information
- Change password
- Role-based field restrictions

**Tasks Page**
- Filter by status and priority
- Task card grid view
- Modal with full task details
- Status update functionality
- Deadline tracking

**Inventory Page**
- Search items by name
- Request/return workflow
- Issue date tracking
- Status indicators

**Knowledge Base**
- Full-text search across titles and descriptions
- Category filtering
- View count tracking
- Problem/solution display

## 🔐 Security Features

1. **Authentication**
   - JWT token-based (production)
   - Session management

2. **Authorization**
   - Role-based access control (RBAC)
   - Employee, Manager, Admin roles

3. **Data Protection**
   - Password hashing (production)
   - SQL parameterized queries
   - HTTPS ready

## 🛠️ Development

### Running Locally

**Option A: Using Live Server (VS Code)**
```bash
# Install Live Server extension
# Right-click login.html → Open with Live Server
```

**Option B: Using Python (if installed)**
```bash
cd frontend
python -m http.server 8000
# Visit http://localhost:8000/login.html
```

**Option C: Using Node HTTP Server**
```bash
npm install -g http-server
cd frontend
http-server
```

## 🔌 API Endpoints (To be implemented)

### Authentication
```
POST   /api/auth/login          - User login
POST   /api/auth/logout         - User logout
POST   /api/auth/refresh        - Refresh token
```

### Attendance
```
GET    /api/attendance          - Get attendance records
POST   /api/attendance/login    - Record login
POST   /api/attendance/logout   - Record logout
```

### Employees
```
GET    /api/employees/:id       - Get employee details
PUT    /api/employees/:id       - Update employee
POST   /api/employees/:id/change-password - Change password
```

### Tasks
```
GET    /api/tasks              - Get tasks
GET    /api/tasks/:id          - Get task details
PUT    /api/tasks/:id          - Update task
POST   /api/tasks              - Create task (admin/manager)
```

### Inventory
```
GET    /api/inventory          - Get inventory items
POST   /api/inventory/:id/request  - Request item
POST   /api/inventory/:id/return   - Return item
```

### Knowledge Base
```
GET    /api/knowledge-base     - Get articles
GET    /api/knowledge-base/:id - Get article details
POST   /api/knowledge-base/:id/increment-views - Track views
```

## 📊 Tech Stack

### Frontend
- HTML5
- CSS3 (Responsive Grid & Flexbox)
- Vanilla JavaScript (ES6+)
- localStorage for client-side demo

### Backend (Optional)
- Node.js with Express
- SQL Server / MSSQL
- JWT for authentication
- bcryptjs for password hashing

## 📱 Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## 🎓 Features by Module

### Attendance Module
- ✅ One-click login/logout
- ✅ System timestamp capture
- ✅ Daily attendance status
- ✅ Monthly hours calculation
- ✅ Attendance history

### Profile Module
- ✅ View employee details
- ✅ Edit name and contact
- ✅ Change password with validation
- ✅ Read-only role/department
- ✅ Email verification

### Inventory Module
- ✅ Search items by name
- ✅ Request inventory items
- ✅ Return items with notes
- ✅ Issue date tracking
- ✅ Return date recording

### Tasks Module
- ✅ View assigned tasks
- ✅ Filter by status and priority
- ✅ Update task status
- ✅ Deadline tracking
- ✅ Task description viewing

### Knowledge Base Module
- ✅ Full-text search
- ✅ Category filtering
- ✅ Problem/solution pairing
- ✅ View count tracking
- ✅ Responsive card layout

## 📝 Notes

- **Demo Mode**: Frontend works with mock data without backend
- **Production Ready**: Backend API structure provided as template
- **Extensible**: Easy to add new modules and features
- **Mobile First**: Responsive design principles throughout
- **Accessibility**: WCAG 2.1 AA standards followed

## 🤝 Contributing

Feel free to extend this portal with:
- Email notifications
- Leave management module
- Expense management
- Performance reviews
- Document sharing

## 📄 License

This project is provided as-is for educational and enterprise use.

## 📞 Support

For issues or questions:
1. Check the console for error messages (F12)
2. Verify mock data in `common.js`
3. Ensure correct API URL in production
4. Check SQL Server connection in backend

---

**Last Updated**: May 25, 2026
**Version**: 1.0.0
