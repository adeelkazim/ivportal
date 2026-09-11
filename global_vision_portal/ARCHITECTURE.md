# Global Vision Portal - Project Overview & Architecture

## 📋 Project Summary

**Global Vision Portal** is a comprehensive employee management system built with:
- **Frontend**: HTML5, CSS3, Vanilla JavaScript (responsive, no frameworks)
- **Backend**: Node.js/Express (template provided)
- **Database**: SQL Server 2019+

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     USER BROWSER                                │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  HTML Pages (login, dashboard, profile, tasks, etc.)     │  │
│  │  CSS Styling (responsive, mobile-first)                  │  │
│  │  JavaScript (event handling, API calls, data validation) │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                            │
                   HTTP/HTTPS │ REST API
                            │
┌─────────────────────────────────────────────────────────────────┐
│                  NODE.JS/EXPRESS BACKEND                        │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Route Handlers                                           │  │
│  │  - Authentication (/auth/login, /auth/logout)           │  │
│  │  - Attendance (/attendance/login, /attendance/logout)   │  │
│  │  - Employees (/employees/:id)                           │  │
│  │  - Tasks (/tasks, /tasks/:id)                           │  │
│  │  - Inventory (/inventory)                               │  │
│  │  - Knowledge Base (/knowledge-base)                     │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Business Logic & Controllers                            │  │
│  │  - Data validation                                       │  │
│  │  - Authorization checks                                 │  │
│  │  - Business rules enforcement                           │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                            │
                   SQL Queries │ ODBC/JDBC
                            │
┌─────────────────────────────────────────────────────────────────┐
│                  SQL SERVER DATABASE                            │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Employees      - User master data                       │  │
│  │  Attendance     - Login/logout records                   │  │
│  │  Tasks          - Task assignments and status            │  │
│  │  Inventory      - Item tracking and issuance             │  │
│  │  KnowledgeBase  - FAQ and solutions                      │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📊 Data Flow

### Login Process
```
User inputs credentials
         ↓
Frontend validates email format
         ↓
Sends POST /api/auth/login
         ↓
Backend queries Employees table
         ↓
Compares password hashes (bcryptjs)
         ↓
Generates JWT token
         ↓
Returns token + user data
         ↓
Frontend stores token in localStorage
         ↓
Redirects to dashboard
```

### Attendance Recording
```
User clicks Login/Logout button
         ↓
Frontend records timestamp
         ↓
Sends POST /api/attendance/login or /logout
         ↓
Backend inserts/updates Attendance table
         ↓
Returns confirmation
         ↓
Frontend updates status display
```

### Task Management Flow
```
Manager creates task (POST /tasks)
         ↓
Backend inserts into Tasks table
         ↓
Employee sees task on dashboard
         ↓
Employee updates status (PUT /tasks/:id)
         ↓
Backend updates Tasks table
         ↓
Manager sees updated status
```

---

## 🔐 Security Architecture

### Authentication Flow
```
1. User logs in with email/password
2. Backend validates credentials
3. Password verified against bcrypt hash
4. JWT token generated (expires in 7 days)
5. Token sent to frontend
6. Frontend stores token in secure localStorage
7. All API requests include Authorization header
8. Backend validates token with every request
9. Unauthorized requests rejected (401)
```

### Authorization Levels
```
┌─────────────────┐
│  Admin Role     │
│  - All access   │
│  - Manage users │
│  - View reports │
└─────────────────┘
       ↑
┌─────────────────┐
│  Manager Role   │
│  - Assign tasks │
│  - View reports │
│  - Approve leave│
└─────────────────┘
       ↑
┌─────────────────┐
│  Employee Role  │
│  - View tasks   │
│  - Update tasks │
│  - View profile │
└─────────────────┘
```

---

## 📁 Detailed File Structure

### Frontend Files
```
frontend/
├── login.html                 [Entry point - Login form]
├── dashboard.html            [Main dashboard - Quick view]
├── profile.html              [User profile - Edit info]
├── tasks.html                [Task management - Status updates]
├── inventory.html            [Inventory tracking - Request/Return]
├── knowledge-base.html       [FAQ search - Category filter]
├── css/
│   └── style.css             [Master stylesheet - 800+ lines]
│       ├── CSS Variables (colors, sizing, shadows)
│       ├── Global styles (typography, spacing)
│       ├── Component styles (cards, buttons, forms)
│       ├── Layout styles (grid, flexbox)
│       ├── Responsive design (mobile, tablet, desktop)
│       └── Animations (slideIn, fadeIn)
└── js/
    ├── common.js             [Shared utilities - 400+ lines]
    │   ├── API wrapper functions
    │   ├── LocalStorage management
    │   ├── Authentication checks
    │   ├── Modal management
    │   ├── Form validation
    │   └── Mock data for demo
    ├── login.js              [Authentication logic]
    ├── dashboard.js          [Dashboard data loading]
    ├── profile.js            [Profile management]
    ├── tasks.js              [Task operations & filtering]
    ├── inventory.js          [Item request/return]
    └── knowledge-base.js     [Search & filtering]
```

### Backend Files (Template)
```
backend/
├── server.js                 [Express server - Route setup]
├── package.json              [Dependencies & scripts]
├── .env.example              [Configuration template]
└── config.md                 [Setup instructions]

Structure for complete backend (TODO):
├── routes/
│   ├── auth.js              [Login/logout endpoints]
│   ├── attendance.js        [Attendance endpoints]
│   ├── employees.js         [Employee endpoints]
│   ├── tasks.js             [Task endpoints]
│   ├── inventory.js         [Inventory endpoints]
│   └── knowledge-base.js    [KB endpoints]
├── controllers/
│   ├── authController.js
│   ├── attendanceController.js
│   ├── employeeController.js
│   ├── taskController.js
│   ├── inventoryController.js
│   └── kbController.js
├── models/
│   └── database.js          [MSSQL connection pool]
├── middleware/
│   ├── auth.js              [JWT verification]
│   ├── validate.js          [Input validation]
│   └── errorHandler.js      [Error handling]
└── utils/
    ├── jwt.js               [Token generation]
    ├── bcrypt.js            [Password hashing]
    └── logger.js            [Logging]
```

### Database Files
```
database/
└── schema.sql               [Complete DB schema]
    ├── Employees table
    ├── Attendance table
    ├── Inventory table
    ├── KnowledgeBase table
    ├── Tasks table
    ├── Foreign key constraints
    ├── Indexes for performance
    └── Sample data (50+ records)
```

---

## 💾 Database Schema Details

### Employees Table
```sql
- EmployeeID (INT, PK)
- Name (VARCHAR 100)
- Email (VARCHAR 100, UNIQUE)
- Department (VARCHAR 50)
- Role (VARCHAR 50) - 'Employee', 'Manager', 'Admin'
- Contact (VARCHAR 20)
- PasswordHash (VARCHAR 255)
- CreatedAt (DATETIME)
- UpdatedAt (DATETIME)
```

### Attendance Table
```sql
- AttendanceID (INT, PK)
- EmployeeID (INT, FK)
- Date (DATE)
- LoginTime (DATETIME)
- LogoutTime (DATETIME, nullable)
- TotalHours (DECIMAL 5,2)
- CreatedAt (DATETIME)
-- Index on (EmployeeID, Date) for fast queries
```

### Tasks Table
```sql
- TaskID (INT, PK)
- Title (VARCHAR 200)
- Description (VARCHAR MAX)
- AssignedTo (INT, FK)
- AssignedBy (INT, FK)
- Status (VARCHAR 50) - 'Pending', 'In Progress', 'Completed', 'On Hold'
- Priority (VARCHAR 50) - 'High', 'Medium', 'Low'
- Deadline (DATETIME)
- CompletedDate (DATETIME, nullable)
- CreatedAt (DATETIME)
- UpdatedAt (DATETIME)
-- Indexes on Status, AssignedTo, Deadline
```

### Inventory Table
```sql
- ItemID (INT, PK)
- ItemName (VARCHAR 100)
- Quantity (INT)
- AvailableQuantity (INT)
- IssuedTo (INT, FK)
- IssueDate (DATETIME)
- ReturnDate (DATETIME, nullable)
- Status (VARCHAR 50)
- CreatedAt (DATETIME)
- UpdatedAt (DATETIME)
```

### KnowledgeBase Table
```sql
- ProblemID (INT, PK)
- Title (VARCHAR 200)
- Description (VARCHAR MAX)
- Solution (VARCHAR MAX)
- Category (VARCHAR 100)
- AddedBy (INT, FK)
- ViewCount (INT)
- CreatedAt (DATETIME)
- UpdatedAt (DATETIME)
-- Indexes on Title, Category for search performance
```

---

## 🚀 API Endpoints (To be Implemented)

### Authentication
```
POST   /api/auth/login              - User login
POST   /api/auth/logout             - User logout
POST   /api/auth/refresh            - Refresh JWT token
POST   /api/auth/change-password    - Change password
```

### Attendance
```
GET    /api/attendance              - Get attendance records
GET    /api/attendance/:id          - Get specific record
POST   /api/attendance/login        - Record login
POST   /api/attendance/logout       - Record logout
GET    /api/attendance/stats        - Monthly stats
```

### Employees
```
GET    /api/employees/:id           - Get employee details
PUT    /api/employees/:id           - Update employee
GET    /api/employees               - Get all (admin only)
POST   /api/employees               - Create employee (admin only)
```

### Tasks
```
GET    /api/tasks                   - Get tasks (filtered)
GET    /api/tasks/:id               - Get task details
POST   /api/tasks                   - Create task (manager+)
PUT    /api/tasks/:id               - Update task status
DELETE /api/tasks/:id               - Delete task (manager+)
```

### Inventory
```
GET    /api/inventory               - Get inventory
GET    /api/inventory/:id           - Get item details
POST   /api/inventory/:id/request   - Request item
POST   /api/inventory/:id/return    - Return item
PUT    /api/inventory/:id           - Update item (admin)
```

### Knowledge Base
```
GET    /api/knowledge-base          - Get articles
GET    /api/knowledge-base/:id      - Get article
POST   /api/knowledge-base          - Create article (admin+)
PUT    /api/knowledge-base/:id      - Update article (admin+)
POST   /api/knowledge-base/:id/increment-views - Track views
```

---

## 🎨 UI/UX Features

### Color Scheme
```
Primary:     #2c3e50 (Dark blue-gray)
Secondary:   #3498db (Bright blue)
Accent:      #e74c3c (Red)
Success:     #27ae60 (Green)
Warning:     #f39c12 (Orange)
Light:       #ecf0f1 (Light gray)
Dark:        #34495e (Darker gray)
```

### Responsive Breakpoints
```
Mobile:    <= 480px   (vertical layout, single column)
Tablet:    481-1024px (2-column layout)
Desktop:   >= 1025px  (multi-column, full layout)
```

### Component Library
```
- Navigation Bar (sticky)
- Cards (stat, task, inventory, kb)
- Buttons (primary, secondary, link)
- Forms (validation, error messages)
- Tables (sortable, pageable - future)
- Modals (task details, return item)
- Messages (success, error, info)
- Filters (status, priority, category)
- Search box (full-text search)
```

---

## 🔧 Technology Stack

### Frontend
- **Language**: JavaScript (ES6+)
- **HTML**: Semantic HTML5
- **CSS**: Pure CSS3 with variables and media queries
- **Architecture**: Vanilla JS (no frameworks)
- **State**: localStorage for client-side storage

### Backend (Template)
- **Runtime**: Node.js 14+
- **Framework**: Express 4.x
- **Database**: Microsoft SQL Server 2019+
- **Driver**: mssql npm package
- **Authentication**: JWT (jsonwebtoken)
- **Password Hashing**: bcryptjs
- **Validation**: express-validator
- **Security**: helmet, CORS

### Database
- **DBMS**: SQL Server 2019+ / Azure SQL
- **Connection**: ODBC / SQL Server Management Studio
- **Indexes**: Performance optimized
- **Constraints**: Foreign keys, UNIQUE constraints

---

## 📈 Performance Considerations

### Database
- Indexes on frequently queried columns
- Proper foreign key relationships
- Query optimization for large datasets

### Frontend
- Lazy loading for images (future)
- Minified CSS/JS (production)
- Client-side data caching
- Pagination (future enhancement)

### Backend
- Connection pooling
- Rate limiting
- Request validation
- Error handling
- Logging

---

## 🔒 Security Best Practices

1. **Authentication**: JWT tokens with 7-day expiration
2. **Password Security**: bcryptjs hashing (10 rounds)
3. **Authorization**: Role-based access control
4. **Data Validation**: Client & server-side validation
5. **HTTPS**: Required for production
6. **CORS**: Properly configured origins
7. **SQL Injection**: Parameterized queries (backend)
8. **XSS Protection**: Helmet headers
9. **CSRF Protection**: Token-based (future)
10. **Audit Logging**: Track all changes (future)

---

## 📊 Sample Data Included

- **4 Employees** with different roles
- **3 Tasks** with varying priorities
- **4 Inventory Items** with issue status
- **4 Knowledge Base Articles** across categories

---

## 🎯 Future Enhancements

- [ ] Email notifications
- [ ] Leave management module
- [ ] Expense tracking
- [ ] Performance reviews
- [ ] Document management
- [ ] Real-time notifications
- [ ] Mobile app (React Native)
- [ ] Analytics dashboard
- [ ] Advanced reporting
- [ ] Workflow automation

---

## 📚 Documentation Files

- `README.md` - Project overview
- `SETUP_GUIDE.md` - Installation & troubleshooting
- `backend/config.md` - Backend configuration
- `ARCHITECTURE.md` - This file

---

**Version**: 1.0.0
**Last Updated**: May 25, 2026
**Maintained By**: Global Vision Team
