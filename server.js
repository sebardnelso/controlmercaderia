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

  // Base de la consulta con JOIN para obtener 'razon' de 'aus_pro'
  let query = `
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
  `;
  let params = [];

  if (codpro) {
    query += ' WHERE aus_pepend.codpro = ?';
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
  const { numero } = req.params;

  if (!numero) {
    return res.status(400).json({ error: 'Número de pedido no proporcionado.' });
  }
  console.log(numero)
  const query = `
    SELECT numero, codigo, codbar, canped, codpro, cantrec, ter 
    FROM aus_pepend 
    WHERE numero = ? AND ter != 1;
  `;

  db.query(query, [numero], (error, results) => {
    if (error) {
      console.error('Error ejecutando la consulta:', error);
      return res.status(500).json({ error: 'Error en el servidor.' });
    }
    res.status(200).json(results);
  });
});


// Ruta para actualizar cantrec
app.post('/actualizar-cantrec', (req, res) => {
  const { codbar, cantrec } = req.body;

  if (!codbar || typeof cantrec !== 'number') {
    return res.status(400).json({ error: 'Datos incompletos o incorrectos.' });
  }

  const getCanPedQuery = 'SELECT canped FROM aus_pepend WHERE codbar = ?';

  db.query(getCanPedQuery, [codbar], (err, results) => {
    if (err) {
      console.error('Error obteniendo canped:', err);
      return res.status(500).json({ error: 'Error en el servidor al obtener canped.' });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: 'Línea no encontrada.' });
    }

    const canped = results[0].canped;
    const pen = (cantrec !== canped) ? 1 : 0;
    const ter = (cantrec === canped) ? 1 : 0;

    const updateQuery = `
      UPDATE aus_pepend 
      SET cantrec = ?, ter = ?, pen = ?
      WHERE codbar = ?
    `;

    db.query(updateQuery, [cantrec, ter, pen, codbar], (updateErr, updateResults) => {
      if (updateErr) {
        console.error('Error actualizando cantrec:', updateErr);
        return res.status(500).json({ error: 'Error al actualizar cantrec.' });
      }

      if (updateResults.affectedRows === 0) {
        return res.status(404).json({ error: 'Línea no encontrada durante la actualización.' });
      }

      // Insertar en aus_pepend2 incluyendo 'pen'
      const insertQuery = `
        INSERT INTO aus_pepend2 (numero, codigo, codbar, canped, codpro, cantrec, ter, pen)
        SELECT numero, codigo, codbar, canped, codpro, ?, ?, ?
        FROM aus_pepend
        WHERE codbar = ?
      `;

      db.query(insertQuery, [cantrec, ter, pen, codbar], (insertErr) => {
        if (insertErr) {
          console.error('Error insertando en aus_pepend2:', insertErr);
          return res.status(500).json({ error: 'Error duplicando línea en aus_pepend2.' });
        }

        res.status(200).json({ message: 'Cantrec actualizado y duplicado en aus_pepend2.' });
      });
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
// Ruta para agregar una nueva línea
app.post('/agregar-linea', (req, res) => {
  const { numero, codbar, cantidad, codigo, codpro } = req.body;

  // Validar los campos requeridos
  if (!numero || !codbar || typeof cantidad !== 'number' || !codigo || !codpro) {
    return res.status(400).json({ error: 'Datos incompletos o incorrectos.' });
  }

  // Verificar si el codbar ya existe en aus_pepend
  const checkCodbarQuery = 'SELECT * FROM aus_pepend WHERE codbar = ?';
  db.query(checkCodbarQuery, [codbar], (checkErr, checkResults) => {
    if (checkErr) {
      console.error('Error verificando codbar existente:', checkErr);
      return res.status(500).json({ error: 'Error en el servidor al verificar codbar existente.' });
    }

    if (checkResults.length > 0) {
      return res.status(400).json({ error: 'El código de barras ya existe en el pedido.' });
    }

    // Obtener el codpro del artículo desde aus_art para verificar
    const getCodProQuery = 'SELECT prove FROM aus_art WHERE id = ?';
    db.query(getCodProQuery, [codigo], (getErr, getResults) => {
      if (getErr) {
        console.error('Error obteniendo codpro del artículo:', getErr);
        return res.status(500).json({ error: 'Error en el servidor al obtener codpro del artículo.' });
      }

      if (getResults.length === 0) {
        return res.status(404).json({ error: 'Artículo no encontrado en aus_art.' });
      }

      const articuloCodPro = getResults[0].prove;

      if (articuloCodPro !== codpro) {
        return res.status(400).json({ error: 'El artículo no pertenece al proveedor actual.' });
      }

      // Si pasa todas las validaciones, insertar la nueva línea
      const insertQuery = `
        INSERT INTO aus_pepend (numero, codbar, canped, codigo, codpro, ter)
        VALUES (?, ?, ?, ?, ?, 0)
      `;

      db.query(insertQuery, [numero, codbar, cantidad, codigo, codpro], (insertErr, insertResults) => {
        if (insertErr) {
          console.error('Error agregando nueva línea:', insertErr);
          return res.status(500).json({ error: 'Error al agregar la nueva línea.' });
        }

        res.status(200).json({ message: 'Nueva línea agregada correctamente.' });
      });
    });
  });
});





// Inicia el servidor
app.listen(port, () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
});
