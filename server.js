require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();

// 1. SERVE THE FRONTEND
app.use(express.static('Public')); 
app.use(express.json());

// 2. DATABASE CONNECTION
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ==========================================
// 3. API ENDPOINTS
// ==========================================

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'Public', 'index.html'));
});

// DEALER LOGIN SYSTEM
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const result = await pool.query(
            'SELECT id, full_name FROM users WHERE username = $1 AND password = $2', 
            [username, password]
        );
        
        if (result.rows.length > 0) {
            res.json({ success: true, user: result.rows[0] });
        } else {
            res.json({ success: false, message: 'Invalid credentials' });
        }
    } catch (err) {
        console.error("Login Error:", err);
        res.status(500).json({ success: false });
    }
});

// Get List of Products
app.get('/api/products', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM products ORDER BY id ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).send('Server Error');
    }
});

// Get Price History
app.get('/api/history/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            'SELECT new_price, recorded_at FROM price_history WHERE product_id = $1 ORDER BY recorded_at DESC LIMIT 20',
            [id]
        );
        res.json(result.rows.reverse());
    } catch (err) {
        res.status(500).send('Server Error');
    }
});

// BUY NOW (Transaction) - Now linked to specific user_id
app.post('/api/orders', async (req, res) => {
    const client = await pool.connect();
    try {
        const { user_id, product_id, quantity, locked_price } = req.body;
        await client.query('BEGIN');

        // Replaced the hardcoded '1' with the actual user_id from the login
        const orderRes = await client.query(
            'INSERT INTO orders (user_id, total_amount, status) VALUES ($1, $2, $3) RETURNING id',
            [user_id, locked_price * quantity, 'CONFIRMED']
        );
        const orderId = orderRes.rows[0].id;

        await client.query(
            'INSERT INTO order_items (order_id, product_id, quantity, sold_at_price, subtotal) VALUES ($1, $2, $3, $4, $5)',
            [orderId, product_id, quantity, locked_price, locked_price * quantity]
        );

        await client.query('COMMIT');
        res.json({ success: true, orderId: orderId });
    } catch (err) {
        console.error("Order Error:", err);
        await client.query