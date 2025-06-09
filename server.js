// server.js
require('dotenv').config(); // Cargar variables de entorno

const express = require('express');
const mysql = require('mysql');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());

// Configurar la conexión a la base de datos MySQL con reconexión automática
const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
};

let db;

function handleDisconnect() {
  db = mysql.createConnection(dbConfig);

  db.connect((err) => {
    if (err) {
      console.error('Error connecting to the database:', err);
      setTimeout(handleDisconnect, 2000);
    } else {
      console.log('Connected to the MySQL database');
    }
  });

  db.on('error', (err) => {
    console.error('Database error:', err);
    if (err.code === 'PROTOCOL_CONNECTION_LOST') {
      handleDisconnect();
    } else {
      throw err;
    }
  });
}

handleDisconnect();

// Mantener la conexión activa
setInterval(() => {
  db.query('SELECT 1', (err) => {
    if (err) {
      console.error('Error keeping the connection alive:', err);
    }
  });
}, 5000);

// Endpoint de autenticación
app.post('/login', (req, res) => {
  const { nombre, password } = req.body;
  const query = 'SELECT * FROM aus_usuario WHERE nombre = ? AND password = ?';

  db.query(query, [nombre, password], (err, results) => {
    if (err) {
      res.status(500).json({ error: 'Error en el servidor' });
      return;
    }

    if (results.length > 0) {
      res.status(200).json({ message: 'Autenticación exitosa' });
    } else {
      res.status(401).json({ error: 'Nombre de usuario o contraseña incorrectos' });
    }
  });
});

// Ruta para obtener los pedidos pendientes
// ... código existente

// Ruta para obtener pedidos filtrados por codpro
// Ruta para obtener pedidos con 'razon' del proveedor
app.get('/pedidos', (req, res) => {
  const { codpro } = req.query;

  let query = `
    SELECT numero, codigo, codbar, canped, codpro, cantrec, ter, razon, origen FROM (
      SELECT 
        p1.numero, p1.codigo, p1.codbar, p1.canped, p1.codpro, p1.cantrec, p1.ter,
        pr.razon,
        'pepend' as origen
      FROM aus_pepend p1
      INNER JOIN aus_pro pr ON p1.codpro = pr.codigo

      UNION ALL

      SELECT 
        p2.numero, p2.codigo, p2.codbar, p2.canped, p2.codpro, p2.cantrec, p2.ter,
        pr.razon,
        'pepend2' as origen
      FROM aus_pepend2 p2
      INNER JOIN aus_pro pr ON p2.codpro = pr.codigo
      WHERE p2.pen = 1
    ) as combined
  `;

  const params = [];

  if (codpro) {
    query += ' WHERE codpro = ?';
    params.push(codpro);
  }

  db.query(query, params, (err, results) => {
    if (err) {
      console.error('Error ejecutando la consulta:', err);
      res.status(500).json({ error: 'Error en el servidor' });
      return;
    }
    res.status(200).json(results);
  });
});



// Ruta para sincronizar pedidos
app.post('/sync/pedidos', (req, res) => {
  const { pedidos } = req.body;

  if (!Array.isArray(pedidos)) {
    return res.status(400).json({ error: 'Formato de datos incorrecto.' });
  }

  // Asumiendo que 'aus_pepen' es la tabla donde se almacenan los pedidos
  const values = pedidos.map(pedido => [
    pedido.numero,
    pedido.codigo,
    pedido.codbar,
    pedido.canped,
    pedido.codpro,
    pedido.cantrec,
    pedido.ter,
  ]);

  const query = `
    INSERT INTO aus_pepen (numero, codigo, codbar, canped, codpro, cantrec, ter)
    VALUES ?
    ON DUPLICATE KEY UPDATE
      codigo = VALUES(codigo),
      codbar = VALUES(codbar),
      canped = VALUES(canped),
      codpro = VALUES(codpro),
      cantrec = VALUES(cantrec),
      ter = VALUES(ter)
  `;

  db.query(query, [values], (err, results) => {
    if (err) {
      console.error('Error sincronizando pedidos:', err);
      return res.status(500).json({ error: 'Error al sincronizar pedidos.' });
    }
    res.status(200).json({ message: 'Pedidos sincronizados correctamente.' });
  });
});

// ... código existente

// Ruta para sincronizar actualizaciones
app.post('/sync/actualizaciones', (req, res) => {
  const { codbar, cantrec } = req.body;

  if (!codbar || typeof cantrec !== 'number') {
    return res.status(400).json({ error: 'Datos incompletos.' });
  }

  const query = `
    UPDATE aus_pepend
    SET cantrec = ?, ter = 1
    WHERE codbar = ?
  `;

  db.query(query, [cantrec, codbar], (err, results) => {
    if (err) {
      console.error('Error actualizando cantrec:', err);
      return res.status(500).json({ error: 'Error al actualizar cantrec.' });
    }
    res.status(200).json({ message: 'Cantidad recibida actualizada correctamente.' });
  });
});

// ... código existente

// Ruta para obtener líneas filtradas por numero de pedido
app.get('/lineas/:numero', (req, res) => {
  const numero = req.params.numero;

  // Primero buscar en aus_pepend
  db.query('SELECT * FROM aus_pepend WHERE numero = ? AND ter != 1', [numero], (err, rows) => {
    if (err) {
      console.error('Error consultando aus_pepend:', err);
      return res.status(500).json({ error: 'Error en el servidor (aus_pepend)' });
    }

    if (rows.length > 0) {
      return res.status(200).json(rows);
    }

    // Si no encontró en aus_pepend, buscar en aus_pepend2
    db.query('SELECT * FROM aus_pepend2 WHERE numero = ? AND ter != 1', [numero], (err2, rows2) => {
      if (err2) {
        console.error('Error consultando aus_pepend2:', err2);
        return res.status(500).json({ error: 'Error en el servidor (aus_pepend2)' });
      }

      if (rows2.length > 0) {
        return res.status(200).json(rows2);
      }

      // Si no hay en ninguna tabla
      return res.status(404).json([]);
    });
  });
});



// Ruta para actualizar cantrec
app.post('/actualizar-cantrec', (req, res) => {
  const { codbar, cantrec, usuario, fecha, hora } = req.body;

  if (!codbar || typeof cantrec !== 'number' || !usuario || !fecha || !hora) {
    return res.status(400).json({ error: 'Datos incompletos o incorrectos.' });
  }

  const query = `
    SELECT 'pepend' as origen, canped, numero, codigo, codpro FROM aus_pepend WHERE codbar = ?
    UNION ALL
    SELECT 'pepend2' as origen, canped, numero, codigo, codpro FROM aus_pepend2 WHERE codbar = ?
  `;

  db.query(query, [codbar, codbar], (err, rows) => {
    if (err) {
      console.error('❌ Error consultando tablas:', err);
      return res.status(500).json({ error: 'Error interno' });
    }

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Línea no encontrada en ninguna tabla' });
    }

    const row = rows[0];
    const canped = row.canped;
    const pen = (cantrec !== canped) ? 1 : 0;
    const ter = (cantrec === canped) ? 1 : 0;

    const updates = [];

    if (rows.some(r => r.origen === 'pepend')) {
      updates.push(new Promise((resolve, reject) => {
        db.query(`
          UPDATE aus_pepend
          SET cantrec = ?, ter = ?, pen = ?, usuario = ?, fecha = ?, hora = ?
          WHERE codbar = ?
        `, [cantrec, ter, pen, usuario, fecha, hora, codbar], err => {
          if (err) return reject(err);
          resolve();
        });
      }));
    }

    if (rows.some(r => r.origen === 'pepend2')) {
      updates.push(new Promise((resolve, reject) => {
        db.query(`
          UPDATE aus_pepend2
          SET cantrec = ?, ter = ?, pen = ?, usuario = ?, fecha = ?, hora = ?
          WHERE codbar = ?
        `, [cantrec, ter, pen, usuario, fecha, hora, codbar], err => {
          if (err) return reject(err);
          resolve();
        });
      }));
    }

    if (rows.some(r => r.origen === 'pepend') && !rows.some(r => r.origen === 'pepend2')) {
      const { numero, codigo, codpro } = row;
      updates.push(new Promise((resolve, reject) => {
        db.query(`
          INSERT INTO aus_pepend2 (numero, codigo, codbar, canped, codpro, cantrec, ter, pen, usuario, fecha, hora)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [numero, codigo, codbar, canped, codpro, cantrec, ter, pen, usuario, fecha, hora], err => {
          if (err) return reject(err);
          resolve();
        });
      }));
    }

    if (rows.some(r => r.origen === 'pepend2') && !rows.some(r => r.origen === 'pepend')) {
      const { numero, codigo, codpro } = row;
      updates.push(new Promise((resolve, reject) => {
        db.query(`
          INSERT INTO aus_pepend (numero, codigo, codbar, canped, codpro, cantrec, ter, pen, usuario, fecha, hora)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [numero, codigo, codbar, canped, codpro, cantrec, ter, pen, usuario, fecha, hora], err => {
          if (err) return reject(err);
          resolve();
        });
      }));
    }

    Promise.all(updates)
      .then(() => res.status(200).json({ message: 'Actualización exitosa.' }))
      .catch(error => {
        console.error('❌ Error en actualizaciones:', error);
        res.status(500).json({ error: 'Error actualizando las tablas.' });
      });
  });
});




app.post('/recuperar-cantidades', (req, res) => {
  const { numero } = req.body;

  if (!numero) {
    return res.status(400).json({ error: 'Número no proporcionado.' });
  }

  const query = `
    SELECT codbar, cantrec
    FROM aus_pepend2
    WHERE numero = ? AND ter = 0
  `;

  db.query(query, [numero], (err, results) => {
    if (err) {
      console.error('Error recuperando cantidades:', err);
      return res.status(500).json({ error: 'Error en el servidor al recuperar cantidades.' });
    }

    res.status(200).json(results);
  });
});




// Ruta para obtener líneas pendientes
app.get('/pendientes', (req, res) => {
  const query = `
    SELECT 
      aus_pepend.numero, 
      aus_pepend.codigo, 
      aus_pepend.codbar, 
      aus_pepend.canped, 
      aus_pepend.codpro, 
      aus_pepend.cantrec, 
      aus_pepend.ter,
      aus_pro.razon
    FROM aus_pepend
    INNER JOIN aus_pro ON aus_pepend.codpro = aus_pro.codigo
    WHERE aus_pepend.pen = 1;
  `;

  db.query(query, (err, results) => {
    if (err) {
      console.error('Error obteniendo pendientes:', err);
      return res.status(500).json({ error: 'Error en el servidor al obtener pendientes.' });
    }

    res.status(200).json(results);
  });
});
// Ruta para obtener líneas pendientes de un proveedor específico
app.get('/pendientes/:codpro', (req, res) => {
  const { codpro } = req.params;

  if (!codpro) {
    return res.status(400).json({ error: 'Código de proveedor no proporcionado.' });
  }

  const query = `
    SELECT 
      aus_pepend.numero, 
      aus_pepend.codigo, 
      aus_pepend.codbar, 
      aus_pepend.canped, 
      aus_pepend.codpro, 
      aus_pepend.cantrec, 
      aus_pepend.ter,
      aus_pro.razon
    FROM aus_pepend
    INNER JOIN aus_pro ON aus_pepend.codpro = aus_pro.codigo
    WHERE aus_pepend.pen = 1 AND aus_pepend.codpro = ?;
  `;

  db.query(query, [codpro], (err, results) => {
    if (err) {
      console.error('Error obteniendo pendientes por proveedor:', err);
      return res.status(500).json({ error: 'Error en el servidor al obtener pendientes.' });
    }

    res.status(200).json(results);
  });
});


// Buscar en aus_art por código de barras
app.get('/buscar-codbar/:codbar', (req, res) => {
  const { codbar } = req.params;
  const query = 'SELECT id AS codigo, codbar AS codbarCompleto, prove AS codpro FROM aus_art WHERE codbar LIKE ? LIMIT 1';

  db.query(query, [`%${codbar}%`], (error, results) => {
    if (error) {
      return res.status(500).json({ error: 'Error en la búsqueda' });
    }
    if (results.length > 0) {
      res.json(results[0]);
    } else {
      res.status(404).json({ message: 'Artículo no encontrado' });
    }
  });
});


// Ruta para agregar una nueva línea
app.post('/agregar-linea', (req, res) => {
  const { numero, codbar, cantidad, codigo, codpro } = req.body;

  if (!numero || !codbar || typeof cantidad !== 'number' || !codigo || !codpro) {
    return res.status(400).json({ error: 'Datos incompletos o incorrectos.' });
  }

  // Verificar si el artículo ya existe en alguna tabla
  const checkQuery = `
    SELECT codbar FROM aus_pepend WHERE codbar = ?
    UNION ALL
    SELECT codbar FROM aus_pepend2 WHERE codbar = ?
  `;

  db.query(checkQuery, [codbar, codbar], (checkErr, checkResults) => {
    if (checkErr) {
      console.error('Error verificando codbar existente:', checkErr);
      return res.status(500).json({ error: 'Error al verificar existencia.' });
    }

    if (checkResults.length > 0) {
      return res.status(400).json({ error: 'El código de barras ya existe en el pedido.' });
    }

    // Verificar proveedor del artículo
    const getCodProQuery = 'SELECT prove FROM aus_art WHERE id = ?';
    db.query(getCodProQuery, [codigo], (artErr, artResults) => {
      if (artErr) {
        console.error('Error consultando artículo:', artErr);
        return res.status(500).json({ error: 'Error al obtener el artículo.' });
      }

      if (artResults.length === 0) {
        return res.status(404).json({ error: 'Artículo no encontrado.' });
      }

      const artCodPro = artResults[0].prove;
      if (artCodPro !== codpro) {
        return res.status(400).json({ error: 'El artículo no pertenece al proveedor indicado.' });
      }

      // Verificar si el pedido es viejo (existe en aus_pepend2 con pen = 1)
      const checkPedidoViejo = `
        SELECT numero FROM aus_pepend2 WHERE numero = ? AND pen = 1 LIMIT 1
      `;

      db.query(checkPedidoViejo, [numero], (pedErr, pedResults) => {
        if (pedErr) {
          console.error('Error consultando pedido viejo:', pedErr);
          return res.status(500).json({ error: 'Error consultando tipo de pedido.' });
        }

        const tablaDestino = pedResults.length > 0 ? 'aus_pepend2' : 'aus_pepend';
        const pen = pedResults.length > 0 ? 1 : 0;

        const insertQuery = `
          INSERT INTO ${tablaDestino} (numero, codbar, canped, codigo, codpro, cantrec, ter, pen)
          VALUES (?, ?, ?, ?, ?, 0, 0, ?)
        `;

        db.query(insertQuery, [numero, codbar, cantidad, codigo, codpro, pen], (insErr) => {
          if (insErr) {
            console.error('Error insertando línea:', insErr);
            return res.status(500).json({ error: 'Error al insertar la nueva línea.' });
          }

          return res.status(200).json({ message: 'Línea agregada correctamente.', tabla: tablaDestino });
        });
      });
    });
  });
});







// Inicia el servidor
app.listen(port, () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
});

