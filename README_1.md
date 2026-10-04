# CS Faculty Directory

A full-stack web app: a public, searchable list of Computer Science faculty, and a password-protected admin area to add, edit and delete them.

- **Frontend:** plain HTML, CSS and JavaScript in `public/`
- **Backend:** Node.js and Express (`server.js`)
- **Database:** PostgreSQL (`db.js`). Tables are created automatically on first start.
- **Admin:** one password. Visitors can only read.

## Put it online (free) so you get a link for Instagram

You need two free accounts: **GitHub** (stores the code) and **Render** (runs the app), plus **Neon** (the database).

### 1. Create the database (Neon)
1. Sign up at neon.tech and create a project.
2. Copy the **connection string**. It starts with `postgresql://`. Keep it for step 3.

### 2. Upload the code to GitHub
1. Create a new empty repository on github.com.
2. Upload every file from this folder except `node_modules`. (On the repository page: Add file, then Upload files.)

### 3. Run it on Render
1. Sign up at render.com and choose **New, then Blueprint**, and pick your GitHub repository. Render reads `render.yaml` and fills in most settings.
2. When asked, enter two values:
   - `DATABASE_URL`: the Neon connection string from step 1.
   - `ADMIN_PASSWORD`: a password only you know (at least 8 characters).
3. Click deploy. After a few minutes you get a link like `https://cs-faculty-directory.onrender.com`.

### 4. Add the faculty
1. Open your link and click **Admin sign in** at the bottom.
2. Enter your `ADMIN_PASSWORD`. Then use **Add faculty**, or **Import or export** to paste a CSV for everyone at once.

### 5. Share on Instagram
Put the link in your bio (Edit profile, then Links) or in a story link sticker. Links in post captions are not tappable.

> **Free tier note:** Render's free plan puts the app to sleep after about 15 minutes without visitors. The first person to open it afterwards waits roughly 30 to 60 seconds. Data is never lost, because it lives in Neon. A paid Render plan removes the delay.

## Run it on your own computer

```bash
npm install
export DATABASE_URL="postgresql://user:pass@localhost:5432/faculty"
export ADMIN_PASSWORD="choose-a-password"
export SESSION_SECRET="any-long-random-text"
npm start        # http://localhost:3000
npm test         # runs the API tests (uses an in-memory database)
```

## CSV columns for import

`name,designation,qualification,areas,email,office,hours,phone,courses,link,bio`

Separate several research areas in one cell with semicolons. Rows whose name or email already exists are skipped. Only `name` is required.

## Security notes

- Changes require the admin password. The session cookie is HttpOnly and expires after 12 hours.
- Login is limited to 8 wrong attempts per 10 minutes per address.
- All input is checked on the server, and everything is shown as plain text in the page.
- Never commit your real `DATABASE_URL` or `ADMIN_PASSWORD` to GitHub. Enter them only in Render.
