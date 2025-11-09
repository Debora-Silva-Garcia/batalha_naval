// Importa módulos necessários
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

// Cria app e servidor
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Servir arquivos estáticos da pasta "public" (cliente)
app.use(express.static("public"));

// Quando um cliente se conecta
io.on("connection", (socket) => {
  console.log("Novo jogador conectado!");

  socket.on("disconnect", () => {
    console.log("Jogador desconectado.");
  });
});

// Inicia servidor na porta 3000
server.listen(3000, () => {
  console.log("Servidor rodando em http://localhost:3000");
});
