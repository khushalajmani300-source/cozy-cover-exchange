require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();

// 1. SERVE THE FRONTEND
// This tells Node to look into the 'public' folder for index.html
app.use(express.static(path.join(__dirname, 'Public'))); 
app.use(express.json());

// 2. DATABASE CONNECTION
// On Render, we will use a Connection String (URL) instead of separate variables
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Required for most cloud DB providers like Render
  }
});

// ==========================================
// 3. API ENDPOINTS
// ==========================================
// FORCE THE SERVER TO SHOW THE WEBSITE ON THE MAIN PAGE
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'Public', 'index.html'));
});
// Get List of Products
app.get('/api/products', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM products ORDER BY id ASC');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// Get Price History for Graphs
app.get('/api/history/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            'SELECT new_price, recorded_at FROM price_history WHERE product_id = $1 ORDER BY recorded_at DESC LIMIT 20',
            [id]
        );
        res.json(result.rows.reverse());
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// BUY NOW (Transaction)
app.post('/api/orders', async (req, res) => {
    const client = await pool.connect();
    try {
        const { product_id, quantity, locked_price } = req.body;
        await client.query('BEGIN');

        const orderRes = await client.query(
            'INSERT INTO orders (user_id, total_amount, status) VALUES ($1, $2, $3) RETURNING id',
            [1, locked_price * quantity, 'CONFIRMED']
        );
        const orderId = orderRes.rows[0].id;

        await client.query(
            'INSERT INTO order_items (order_id, product_id, quantity, sold_at_price, subtotal) VALUES ($1, $2, $3, $4, $5)',
            [orderId, product_id, quantity, locked_price, locked_price * quantity]
        );

        await client.query('COMMIT');
        res.json({ success: true, orderId: orderId });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ success: false });
    } finally {
        client.release();
    }
});

// ==========================================
// 4. THE TRADING BOT ENGINE
// ==========================================
async function updatePrices() {
    const client = await pool.connect();
    try {
        const res = await client.query('SELECT * FROM products WHERE is_active = TRUE');
        for (let product of res.rows) {
             const direction = Math.random() >= 0.5 ? 1 : -1; 
             const percentChange = (Math.random() * 0.05) + 0.01; 
             let newPrice = Number(product.current_price) + (Number(product.current_price) * percentChange * direction);

             if (newPrice < Number(product.floor_price)) newPrice = Number(product.floor_price);
             if (newPrice > Number(product.ceiling_price)) newPrice = Number(product.ceiling_price);

             newPrice = Math.round(newPrice / 10) * 10;

             if (newPrice !== Number(product.current_price)) {
                 await client.query('UPDATE products SET current_price = $1 WHERE id = $2', [newPrice, product.id]);
                 await client.query('INSERT INTO price_history (product_id, new_price) VALUES ($1, $2)', [product.id, newPrice]);
             }
        }
    } catch (err) {
        console.error("Bot Error:", err);
    } finally {
        client.release();
    }
}

setInterval(updatePrices, 5000);

// 5. START SERVER
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});