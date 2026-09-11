const { parseAttendanceFile } = require('../utils/parseAttendanceFile');

const csv = [
    'EmployeeID,Date,LoginTime,LogoutTime,TotalHours,CreatedAt',
    '3,2026-05-01,09:00:00,,,2026-05-01 09:00:00',
    '4,2026-05-01,08:45:00,17:00:00,8:15:00,2026-05-01 08:45:00',
    '5,2026-05-03,10:00:00,18:00:00,-,2026-05-03',
    '6,2026-05-04,10:00:00,18:00:00,#N/A,2026-05-04',
].join('\n');

const rows = parseAttendanceFile(Buffer.from(csv), 'test.csv');
console.log('rows', rows.length);
rows.forEach((r) => console.log(r.employeeId, r.totalHours));
