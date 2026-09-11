# Backend Configuration

## Setup Instructions

### 1. Environment Variables (.env)
Create a `.env` file in the backend directory with the following:

```
# Server
PORT=3000
NODE_ENV=development

# Database
DB_SERVER=localhost
DB_NAME=GlobalVisionPortal
DB_USER=sa
DB_PASSWORD=YourSQLPassword

# JWT
JWT_SECRET=your-super-secret-key-change-this-in-production
JWT_EXPIRE=7d

# CORS
CORS_ORIGIN=http://localhost:5500
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Database Connection

Ensure SQL Server is running and the `GlobalVisionPortal` database is created:

```bash
npm start
```

### 4. Production Build

```bash
npm run build
NODE_ENV=production npm start
```

## API Structure

### Request Headers
All API requests should include:
```
Content-Type: application/json
Authorization: Bearer <jwt_token>
```

### Response Format
All responses follow this format:
```json
{
  "success": true/false,
  "data": {},
  "error": null,
  "timestamp": "2026-05-25T10:00:00Z"
}
```

### Error Codes
- 400: Bad Request
- 401: Unauthorized
- 403: Forbidden
- 404: Not Found
- 500: Server Error

## Development

```bash
npm run dev  # Use nodemon for auto-reload
```

## Testing

```bash
npm test
```

---

**Note**: This is a template. Complete the TODO sections with actual database queries.
