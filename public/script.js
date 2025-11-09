// Conecta ao servidor via WebSocket
const socket = io();

socket.emit("joinGame"); 

socket.on("connect", () => {
  console.log("Conectado ao servidor!");
});
