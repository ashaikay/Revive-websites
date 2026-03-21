# StudioX - Premium Web Design Studio Website

A production-ready, high-conversion website for a freelance web design business. Built with vanilla HTML, CSS, and JavaScript.

## File Structure

```
client-a/
├── index.html          # Main website (all sections)
├── src/
│   ├── styles.css      # Premium styling with dark theme
│   └── script.js       # Navigation, animations, form handling
├── public/             # Static assets (add images here)
├── .env               # Environment variables (if needed)
└── README.md          # This file
```

## Features

- **Premium dark theme** with gradient accents and glassmorphism
- **Fully responsive** - mobile, tablet, laptop, desktop
- **Scroll-triggered animations** for engaging user experience
- **Multi-step quote form** with validation
- **FAQ accordion** with smooth animations
- **Sticky navigation** with mobile menu
- **Accessibility-ready** semantic HTML
- **SEO-optimized** meta tags

## Run Instructions

### Local Development

1. **Simple Method (no server needed):**
   - Open `index.html` directly in your browser
   - Works immediately with full functionality

2. **With Live Server (recommended for development):**
   ```powershell
   # If you have VS Code, use Live Server extension
   # Or use any static server:
   npx serve .
   # Then open http://localhost:3000
   ```

3. **With Python:**
   ```powershell
   python -m http.server 8000
   # Open http://localhost:8000
   ```

## Deploy to Netlify

### Option 1: Drag & Drop
1. Go to [app.netlify.com](https://app.netlify.com)
2. Drag the entire `client-a` folder to the deploy zone
3. Your site is live!

### Option 2: Git Integration
1. Push this folder to GitHub/GitLab/Bitbucket
2. Connect repository to Netlify
3. Set build settings:
   - **Build command:** (leave empty)
   - **Publish directory:** `.` or `/`
4. Deploy!

### Option 3: Netlify CLI
```powershell
npm install -g netlify-cli
netlify login
netlify deploy --prod --dir=.
```

## Configuration & Customization

### Replace Branding

In `index.html`:
- Search for `StudioX` and replace with your business name
- Update the logo in navbar and footer (`.nav-logo`, `.footer-logo`)
- Update contact email: search for `hello@yourstudio.com`
- Update copyright year and business name in footer

### Replace Portfolio Items

Location: `index.html`, lines ~410-510 (search for `portfolio-grid`)

Each portfolio card structure:
```html
<article class="portfolio-card">
  <div class="portfolio-image" style="background: linear-gradient(...);">
    <!-- Replace with: <img src="public/project1.jpg" alt="Project name"> -->
  </div>
  <div class="portfolio-overlay">
    <span class="portfolio-tag">Industry</span>
    <h4 class="portfolio-title">Project Name</h4>
    <div class="portfolio-meta">
      <span>Page Count</span>
      <span>Turnaround</span>
    </div>
    <p class="portfolio-result">Business outcome</p>
  </div>
</article>
```

To add real images:
1. Add images to `public/` folder
2. Replace gradient background with `<img src="public/yourimage.jpg" alt="Description">`
3. Update CSS for `.portfolio-image` if needed

### Connect Quote Form

#### Netlify Forms (Easiest)
The form is already configured for Netlify Forms! When deployed to Netlify:
1. Form submissions appear in Netlify dashboard (Forms section)
2. Set up email notifications in Netlify: Site settings > Forms > Form notifications

#### Supabase Integration
In `src/script.js`, find the form submission handler (~line 155):
```javascript
// Replace simulation code with:
const { createClient } = supabase;
const supabaseClient = createClient('YOUR_SUPABASE_URL', 'YOUR_ANON_KEY');

const { error } = await supabaseClient
  .from('quotes')
  .insert([data]);

if (error) throw error;
```

#### Custom API
```javascript
const response = await fetch('https://your-api.com/quotes', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data)
});
```

### Connect Calendly Booking

Location: `index.html`, search for `consultation-embed-placeholder`

Replace the placeholder with:
```html
<div class="calendly-inline-widget" 
     data-url="https://calendly.com/YOUR_USERNAME/consultation" 
     style="min-width:320px;height:600px;">
</div>
<script type="text/javascript" src="https://assets.calendly.com/assets/external/widget.js" async></script>
```

### Update Pricing

Search for `pricing-grid` in `index.html` to find the pricing cards.
Each card contains:
- `.pricing-amount` - the price number
- `.pricing-features` - list of included features

### Update Hero Stats

Search for `hero-stats` in `index.html`:
```html
<div class="hero-stat">
  <div class="hero-stat-value">50+</div>
  <div class="hero-stat-label">Projects Delivered</div>
</div>
```

### Color Customization

In `src/styles.css`, modify CSS variables at the top:
```css
:root {
  --color-accent-primary: #6366f1;    /* Main accent */
  --color-accent-secondary: #8b5cf6;  /* Secondary accent */
  --gradient-primary: linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #ec4899 100%);
}
```

## Legal Pages

The footer links to `privacy.html` and `terms.html`. Create these files in the root directory with your actual privacy policy and terms of service.

## Browser Support

- Chrome 80+
- Firefox 75+
- Safari 13.1+
- Edge 80+
- Mobile browsers (iOS Safari, Chrome Mobile)

## Performance Notes

- No external dependencies (except Google Fonts)
- Optimized CSS with minimal specificity
- Vanilla JavaScript (no frameworks)
- Lazy loading ready for images
- Smooth animations using CSS transforms (GPU accelerated)

## Need Help?

Integration points are marked with comments in the code:
- `<!-- INTEGRATION POINT: -->` in HTML
- `// INTEGRATION POINT:` in JavaScript

Search these markers to find all customization spots.
