const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(cors());
app.use(express.json());

const db = new sqlite3.Database(':memory:');

// Crear tablas
db.serialize(() => {
  // Categorías
  db.run(`CREATE TABLE categorias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT UNIQUE NOT NULL
  )`);

  // Productos con categoría
  db.run(`CREATE TABLE productos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT,
    descripcion TEXT,
    precio REAL,
    stock INTEGER,
    categoria_id INTEGER,
    FOREIGN KEY(categoria_id) REFERENCES categorias(id)
  )`);

  // Ventas
  db.run(`CREATE TABLE ventas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    producto_id INTEGER,
    cantidad INTEGER,
    fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(producto_id) REFERENCES productos(id)
  )`);

  // Insertar categorías
  db.run(`INSERT INTO categorias (nombre) VALUES
    ('Analgésicos'),
    ('Antibióticos'),
    ('Vitaminas'),
    ('Cuidado Personal')
  `);

  // Insertar productos con categoría_id
  db.run(`INSERT INTO productos (nombre, descripcion, precio, stock, categoria_id) VALUES
    ('Paracetamol', 'Medicamento analgésico', 0.50, 100, 1),
    ('Ibuprofeno', 'Medicamento antiinflamatorio', 0.75, 1, 1),
    ('Amoxicilina', 'Antibiótico penicilínico', 1.20, 80, 2),
    ('Loratadina', 'Antihistamínico para alergias', 0.65, 120, 2),
    ('Multivitamínico', 'Vitaminas diarias', 0.70, 150, 3),
    ('Metformina', 'Medicamento para diabetes', 0.90, 60, 3),
    ('Jabón Liquido', 'Cuidado personal', 1.00, 200, 4),
    ('Crema Antiséptica', 'Cuidado personal', 1.10, 90, 4)
  `);
});

// Endpoints

// Obtener categorías
app.get('/categorias', (req, res) => {
  db.all('SELECT * FROM categorias', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Obtener productos (opcional: filtrar por categoria_id)
app.get('/productos', (req, res) => {
  const { categoria_id } = req.query;
  let sql = `
    SELECT productos.*, categorias.nombre AS categoria_nombre 
    FROM productos 
    LEFT JOIN categorias ON productos.categoria_id = categorias.id
  `;
  const params = [];
  if (categoria_id) {
    sql += ' WHERE categoria_id = ?';
    params.push(categoria_id);
  }
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Registrar venta
app.post('/ventas', (req, res) => {
  const { producto_id, cantidad } = req.body;
  if (!producto_id || !cantidad || cantidad <= 0) {
    return res.status(400).json({ error: 'Datos de venta inválidos' });
  }

  // Verificar stock
  db.get('SELECT stock, nombre FROM productos WHERE id = ?', [producto_id], (err, producto) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });
    if (producto.stock < cantidad) {
      return res.status(400).json({ error: `Stock insuficiente de ${producto.nombre}` });
    }

    // Registrar venta y actualizar stock
    db.run('INSERT INTO ventas (producto_id, cantidad) VALUES (?, ?)', [producto_id, cantidad], function(err) {
      if (err) return res.status(500).json({ error: err.message });

      db.run('UPDATE productos SET stock = stock - ? WHERE id = ?', [cantidad, producto_id], err2 => {
        if (err2) return res.status(500).json({ error: err2.message });
        res.json({ mensaje: `Venta registrada: ${cantidad} unidad(es) de ${producto.nombre}` });
      });
    });
  });
});

// Obtener todas las ventas (con nombre de producto)
app.get('/ventas', (req, res) => {
  const sql = `
    SELECT v.id, p.nombre, v.cantidad, v.fecha
    FROM ventas v
    JOIN productos p ON v.producto_id = p.id
    ORDER BY v.fecha DESC
  `;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Eliminar venta por ID
app.delete('/ventas/:id', (req, res) => {
  const { id } = req.params;

  // Primero obtener la venta para ajustar stock
  db.get('SELECT * FROM ventas WHERE id = ?', [id], (err, venta) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!venta) return res.status(404).json({ error: 'Venta no encontrada' });

    // Recuperar producto para devolver stock
    db.get('SELECT * FROM productos WHERE id = ?', [venta.producto_id], (err2, producto) => {
      if (err2) return res.status(500).json({ error: err2.message });
      if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });

      // Eliminar venta
      db.run('DELETE FROM ventas WHERE id = ?', [id], function(err3) {
        if (err3) return res.status(500).json({ error: err3.message });

        // Devolver stock al producto
        db.run('UPDATE productos SET stock = stock + ? WHERE id = ?', [venta.cantidad, producto.id], (err4) => {
          if (err4) return res.status(500).json({ error: err4.message });
          res.json({ mensaje: 'Venta eliminada correctamente y stock actualizado' });
        });
      });
    });
  });
});

// Actualizar cantidad de una venta
app.put('/ventas/:id', (req, res) => {
  const { id } = req.params;
  const { cantidad } = req.body;

  if (!cantidad || cantidad <= 0) {
    return res.status(400).json({ error: 'Cantidad inválida' });
  }

  // Obtener la venta original y producto para validar stock
  db.get('SELECT * FROM ventas WHERE id = ?', [id], (err, venta) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!venta) return res.status(404).json({ error: 'Venta no encontrada' });

    db.get('SELECT * FROM productos WHERE id = ?', [venta.producto_id], (err2, producto) => {
      if (err2) return res.status(500).json({ error: err2.message });
      if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });

      const diferencia = cantidad - venta.cantidad;

      if (producto.stock < diferencia) {
        return res.status(400).json({ error: 'Stock insuficiente para aumentar la cantidad' });
      }

      // Actualizar venta y stock
      db.run('UPDATE ventas SET cantidad = ? WHERE id = ?', [cantidad, id], function(err3) {
        if (err3) return res.status(500).json({ error: err3.message });

        db.run('UPDATE productos SET stock = stock - ? WHERE id = ?', [diferencia, producto.id], function(err4) {
          if (err4) return res.status(500).json({ error: err4.message });

          res.json({ mensaje: 'Venta actualizada correctamente' });
        });
      });
    });
  });
});

// Eliminar producto por id (opcional, no usado en frontend)
app.delete('/productos/:id', (req, res) => {
  const { id } = req.params;

  db.get('SELECT * FROM productos WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Producto no encontrado' });

    db.run('DELETE FROM productos WHERE id = ?', [id], function(err2) {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json({ mensaje: 'Producto eliminado correctamente' });
    });
  });
});

const PORT = 4000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});


