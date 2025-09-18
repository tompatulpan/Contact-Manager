# Deployment Guide

## 🚀 **You DON'T need a server for production!**

This Contact Management System is a **100% client-side application** that can be deployed to any static hosting service. The local development server is only needed to avoid CORS issues during development.

## Static Hosting Options

### ✅ **Cloudflare Pages** (Recommended)
1. Push your code to GitHub
2. Connect GitHub to Cloudflare Pages
3. Deploy automatically on every push
4. **URL**: `https://your-app.pages.dev`

### ✅ **Netlify**
1. Drag and drop your project folder
2. Automatic deployment
3. **URL**: `https://your-app.netlify.app`

### ✅ **GitHub Pages**
1. Push to GitHub repository
2. Enable Pages in repository settings
3. **URL**: `https://username.github.io/repository-name`

### ✅ **Vercel**
1. Connect GitHub repository
2. Automatic deployments
3. **URL**: `https://your-app.vercel.app`

## Files to Deploy

Deploy these files/folders to your static hosting:
```
/
├── index.html          ← Main entry point
├── style.css           ← Styling
├── lib/
│   └── userbase.js     ← Local Userbase SDK (no CDN dependency!)
├── src/               ← All JavaScript modules
│   ├── app.js         ← Application entry
│   ├── core/          ← Business logic
│   ├── ui/            ← UI components
│   └── utils/         ← Utilities
└── README.md          ← Documentation
```

## Pre-Deployment Checklist

### 1. **Update Userbase App ID**
Edit `src/app.js`:
```javascript
this.config = {
    userbaseAppId: 'YOUR_ACTUAL_USERBASE_APP_ID', // ← Change this!
    // ... other config
};
```

### 2. **Get Userbase App ID**
1. Visit [userbase.com](https://userbase.com)
2. Create free account
3. Create new app
4. Copy the App ID

### 3. **Test Locally** (Optional)
```bash
# Start local server for testing
npm run serve

# Open http://localhost:8080
```

## Cloudflare Pages Deployment

### **Method 1: GitHub Integration** (Recommended)
1. **Push to GitHub**:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/yourusername/your-repo.git
   git push -u origin main
   ```

2. **Connect to Cloudflare Pages**:
   - Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
   - Pages → Create a project
   - Connect to Git → Select your repository
   - Build settings:
     - **Build command**: `npm run build` (or leave empty)
     - **Build output directory**: `/` (root directory)
   - Deploy!

### **Method 2: Direct Upload**
1. **Zip your files**:
   ```bash
   zip -r contact-app.zip . -x "node_modules/*" "tests/*" "*.git*"
   ```

2. **Upload to Cloudflare Pages**:
   - Pages → Create a project
   - Upload assets → Drop your zip file
   - Deploy!

## Post-Deployment

### ✅ **Test Your Deployed App**
1. **Create account** using the sign-up form
2. **Add contacts** and test all features
3. **Share contacts** between different accounts
4. **Export vCards** and QR codes

### ✅ **Custom Domain** (Optional)
- Add your custom domain in Cloudflare Pages settings
- SSL certificate is automatically provided

## Environment-Specific Configuration

### **Production Optimizations**
You can add environment detection in `src/app.js`:

```javascript
const isProduction = window.location.hostname !== 'localhost';

this.config = {
    userbaseAppId: 'your-production-app-id',
    enableDebugMode: !isProduction, // Debug only in development
    // ... other config
};
```

## Security Notes

### ✅ **Already Secure**
- **End-to-end encryption**: Userbase handles all encryption
- **No server needed**: No backend to secure
- **HTTPS enforced**: Static hosts provide SSL automatically

### ✅ **App ID is Safe**
- Userbase App ID can be public (like API keys for client-side apps)
- Real security is in user authentication (handled by Userbase)

## Troubleshooting

### **Userbase SDK Not Loading**
If you see "Userbase SDK not loaded":
1. Verify `lib/userbase.js` exists and has content (should be ~100KB+)
2. Check browser console for any loading errors
3. Ensure your static host is serving the lib/ directory correctly

### **App ID Issues**
1. Verify App ID in `src/app.js` matches your Userbase dashboard
2. Check for typos in the App ID string
3. Ensure App ID is a string (in quotes)

### **CORS Issues** (Development Only)
- Use `npm run serve` for local development
- Production static hosting doesn't have CORS issues

## Success! 🎉

Your Contact Management System is now deployed and accessible worldwide with:
- ✅ **End-to-end encryption**
- ✅ **Real-time synchronization**  
- ✅ **RFC 9553 compliance**
- ✅ **No server maintenance**
- ✅ **Automatic SSL/HTTPS**
- ✅ **Global CDN delivery**

Users can create accounts, manage contacts, and share them securely!