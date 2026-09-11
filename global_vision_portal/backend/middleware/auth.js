const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'global-vision-portal-dev-secret-change-in-production';
const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL || 'admin1234@gmail.com').toLowerCase();

function signToken(user) {
    return jwt.sign(
        {
            employeeId: user.EmployeeID || user.id,
            email: user.Email || user.email,
            role: user.Role || user.role
        },
        JWT_SECRET,
        { expiresIn: '7d' }
    );
}

function authMiddleware(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const token = header.slice(7);
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

function normalizeRole(role) {
    return (role || '').trim().toLowerCase();
}

function isAdminRole(role) {
    const r = normalizeRole(role);
    return r === 'admin' || r === 'superadmin';
}

function requireAdmin(req, res, next) {
    if (!isAdminRole(req.user.role)) {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
}

function requireManagerOrAdmin(req, res, next) {
    const role = normalizeRole(req.user.role);
    if (!isAdminRole(role) && role !== 'manager') {
        return res.status(403).json({ error: 'Manager or Admin access required' });
    }
    next();
}

// Allows: Admin, SuperAdmin, Manager, or TeamLead
function requireTeamAccess(req, res, next) {
    const role = normalizeRole(req.user.role);
    if (isAdminRole(role) || role === 'manager' || role === 'teamlead') return next();
    return res.status(403).json({ error: 'Team access required' });
}

function requireFinanceManager(req, res, next) {
    const role = normalizeRole(req.user.role);
    if (!isAdminRole(role) && role !== 'financemanager') {
        return res.status(403).json({ error: 'Finance Manager access required' });
    }
    next();
}

// Allows: FinanceManager role  OR  Admin/SuperAdmin  OR  the designated Super Admin email
function requireFinanceAccess(req, res, next) {
    const role  = normalizeRole(req.user.role);
    const email = (req.user.email || '').toLowerCase();
    if (role === 'financemanager' || isAdminRole(role) || email === SUPER_ADMIN_EMAIL) {
        return next();
    }
    return res.status(403).json({ error: 'Finance access required' });
}

function isSuperAdminEmail(email) {
    return (email || '').toLowerCase() === SUPER_ADMIN_EMAIL;
}

module.exports = {
    signToken,
    authMiddleware,
    isAdminRole,
    requireAdmin,
    requireManagerOrAdmin,
    requireTeamAccess,
    requireFinanceManager,
    requireFinanceAccess,
    isSuperAdminEmail,
    SUPER_ADMIN_EMAIL,
    JWT_SECRET
};
