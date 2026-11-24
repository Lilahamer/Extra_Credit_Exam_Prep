// This is the main branch to start the web server
//This file initialized Express, sets up middleware (express.statis, express.urlencoded, session managment), and defines your GET/POST routes
//When you run node server.js or npm start, this is the file that calls app.listen(3000)



const express = require('express');
const session=require('express-session');
const knex = require('knex');
const app = express();

// Phase 2: Configure Knex directly in index.js
const db = knex({
  client: 'pg',
  connection: process.env.DATABASE_URL ? {
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false} //required for cloud hosted Postgres like Professor Andersen wants
  } : {
    host: 'localhost',
    user: 'postgres',
    password: "lil'sIS402$",
    database: 'country_catalog',
    port: 5432
  }
});

//Adding the allowed countries object with their corresponding map zoom levels (smaller numbers show a broader area while larger zoom numbers show greater detail)
const countryZooms = {
  'Australia': 4,
  'New Zealand': 5,
  'Fiji': 7,
  'Samoa': 9,
  'Japan': 5,
  'Canada': 3,
  'Italy': 6
};

//Phase 3: Express server, Middleware, and authentication
//1-3 is the Template Engine and Middleware setup

// 1. Tell Express to use EJS for rendering HTML views
app.set('view engine', 'ejs');

// 2. Serve static files (CSS, images) from the 'public' folder
app.use(express.static('public'));

// 3. IMPORTANT: Parses incoming HTML form data (POST) so it appears in req.body
app.use(express.urlencoded({ extended: true })); //Always submit credentials using method="POST" because it requests send data hidden in the HTTP request body (res.body) but GET exposes parameters right in the browser URL bar

// 4. Configure express-session cookies (keeps users logged in across pages) for authentication
app.use(session({
  secret: 'mysecretkey',
  resave: false,
  saveUninitialized: false
}));


//5. Build the Server API route 
app.get('/api/country', (req, res) => {
  const country = req.query.country;

  if (!country) {
    return res.status(400).json({ error: 'Country parameter is required' });
  }

  // Determine zoom level (uses dictionary value if present, else defaults to 5)
  const zoomLevel = countryZooms[country] || 5; //if a country sin't in the dictionary, it defaults to zoom level 5 so any country in database will work

  // Query OpenStreetMap Nominatim from your server
  fetch(`https://nominatim.openstreetmap.org/search?country=${encodeURIComponent(country)}&format=jsonv2&limit=1`, {
    headers: {
      'User-Agent': 'country_catalog_extra_credit',
      'Accept-Language': 'en'
    }
  })
    .then(response => response.json())
    .then(places => {
      if (places.length === 0) {
        return res.status(404).json({ error: 'Place not found' });
      }

      const place = places[0];
      // Return JSON to client
      res.json({
        name: country,
        lat: Number(place.lat),
        lon: Number(place.lon),
        zoom: zoomLevel
      });
    })
    .catch(err => {
      console.error(err);
      res.status(500).json({ error: 'Error retrieving map' });
    });
});


//6. Auth Middleware function to protect routes
function requireAuth(req, res, next) {
  if (req.session && req.session.isLoggedIn) {
    return next(); // User is logged in -> proceed to the route
  }
  res.redirect('/'); // Not logged in -> send to login page
}



// --- PHASE 5: Routes & CRUD implementation ---
// Now you can use `db` inside any route (this connects all three layers: Express/server, Knex/PostgreSQL database, and EJS/view)
app.get('/countries', async (req, res) => { //express lsitens for an incoming HTTP GET request
  const countries = await db('country').select('*'); //tells knex which table (country), seelcts all the columns/rows, "await" pauses function until PostgreSQL finishes retrieving data, and the array of objects are saved into the countries variable
  res.render('index', { countries: countries }); //res is a response object that is used to send data BACK to the browser (not saving data coming from the browser)
}); //express looks in your views folder for views/index.ejs, sends the compiled HTML to the browser
//Note: .select() always returns an array of records, whereas .first() returns a single object (or undefined)

//1. Authentication Routes (Login & Logout)
// Landing Page
app.get('/', (req, res) => {
  res.render('login', { error: null }); // Render login.ejs 
});

// Process Login
app.post('/login', (req, res) => {
  const { username, password } = req.body; // Extract form inputs to authenticate them
  
  // Basic validation (admin and pasword123 is standard practice for web app login credentials)
  if (username === 'admin' && password === 'password123') {
    req.session.isLoggedIn = true; // Set session flag 
    return res.redirect('/countries'); // Redirect to protected page
  }

  res.render('login', { error: 'Invalid username or password' });
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/'); // Clear session and redirect to landing page
  });
});

//2. READ: Display Country List (GET/countries)
app.get('/countries', requireAuth, async (req, res) => {
  try {
    // Knex .select() fetches all records from the table
    const countries = await db('country').select('*').orderBy('country_id', 'asc');
    
    // Render index.ejs and pass database records
    res.render('index', { countries: countries });
  } catch (err) {
    console.error(err);
    res.status(500).send('Database Error');
  }
});

//3. CREATE: Form Display & Form Handler (GET & POST)
// Render Add Form
app.get('/countries/add', requireAuth, (req, res) => {
  res.render('add', { error: null });
});

// Process Add Form Submission
app.post('/countries/add', requireAuth, async (req, res) => {
  const { country_name, popular_site, capital, population, visited } = req.body;

  // Validation
  if (!country_name || country_name.length > 30) {
    return res.render('add', { error: 'Country Name is required (max 30 chars).' });
  }
  if (parseInt(population) < 0 || isNaN(population)) {
    return res.render('add', { error: 'Population must be a non-negative number.' });
  }

  try {
    // Knex .insert() writes a new record into PostgreSQL
    await db('country').insert({ //await pauses the exectution for your route function until PostgreSQL finishes writing the data
      country_name,
      popular_site,
      capital,
      population: parseInt(population), //always convert number inputs into parseint()/parsefloat() before sending them to integer database columns
      visited: visited ? visited.toUpperCase() : null //shorthand of if/else (if visited, then uppercase the user reponse or leave as null)
    });

    // Post/Redirect/Get pattern prevents duplicate submissions on refresh
    res.redirect('/countries');
  } catch (err) {
    console.error(err);
    res.render('add', { error: 'Failed to add country.' });
  }
});

//4. UPDATE: Prefill Edit Form & Save changes (GET & POST)
// Render Edit Form prefilled with existing data
app.get('/countries/edit/:id', requireAuth, async (req, res) => {
  const { id } = req.params; // Access dynamic URL parameter

  try {
    // Knex .first() returns a single object instead of an array
    const country = await db('country').where('country_id', id).first();

    if (!country) {
      return res.redirect('/countries');
    }

    res.render('edit', { country, error: null });
  } catch (err) {
    console.error(err);
    res.redirect('/countries');
  }
});

// Save Updated Record
app.post('/countries/edit/:id', requireAuth, async (req, res) => {
  const { id } = req.params; // URL param identifies target record
  const { country_name, popular_site, capital, population, visited } = req.body;

  try {
    // Knex .update() modifies matching row
    await db('country')
      .where('country_id', id)
      .update({
        country_name,
        popular_site,
        capital,
        population: parseInt(population),
        visited: visited ? visited.toUpperCase() : null
      });

    res.redirect('/countries'); // Redirect back to list
  } catch (err) {
    console.error(err);
    res.render('edit', { country: { ...req.body, country_id: id }, error: 'Failed to update record.' });
  }
});

//5. DELETE: Remove Record (POST /countries/delete/:id)
app.post('/countries/delete/:id', requireAuth, async (req, res) => {
  const { id } = req.params; // Extract target ID from URL

  try {
    // Knex .del() deletes record from database
    await db('country').where('country_id', id).del();
    
    res.redirect('/countries'); // Redirect back to updated list
  } catch (err) {
    console.error(err);
    res.redirect('/countries');
  }
});




//Port Production Ready (doing app.listen (3000...) will fail on cloud hosts):
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});