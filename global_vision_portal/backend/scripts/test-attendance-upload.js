const fs = require('fs');
const path = require('path');

async function main() {
    const loginRes = await fetch('http://localhost:3000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@globalvision.com', password: 'password123' }),
    });
    const loginData = await loginRes.json();
    if (!loginRes.ok) {
        console.error('Login failed:', loginData);
        process.exit(1);
    }
    const token = loginData.token;
    console.log('Login OK, role:', loginData.user.role);

    const csvPath = path.join(__dirname, '../../frontend/sample-attendance.csv');
    const fileBuf = fs.readFileSync(csvPath);
    const boundary = '----TestBoundary' + Date.now();
    const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="employeeId"\r\n\r\n3\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="sample-attendance.csv"\r\nContent-Type: text/csv\r\n\r\n`),
        fileBuf,
        Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const uploadRes = await fetch('http://localhost:3000/api/attendance/upload', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
    });
    const uploadData = await uploadRes.json();
    console.log('Upload', uploadRes.status, JSON.stringify(uploadData, null, 2));

    const attRes = await fetch('http://localhost:3000/api/attendance?employeeId=3', {
        headers: { Authorization: `Bearer ${token}` },
    });
    const records = await attRes.json();
    if (!attRes.ok) {
        console.error('Fetch attendance failed:', records);
        process.exit(1);
    }
    console.log('Records for employee 3:', records.length);
    records.slice(0, 5).forEach((r) => {
        console.log(' ', r.date, r.loginTime, r.logoutTime || '(no logout)');
    });
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
