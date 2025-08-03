# honogram: Chat Room with File Transfer

A blazing-fast real-time chat application with file transfer capabilities built with **Hono**, **TypeScript**, and **WebSockets**.

## Features

✅ Real-time LAN chat for multiple users  
✅ File transfer between clients  
✅ Server sees all messages & file activity  
✅ Colored, timestamped console messages  
✅ Chat log saved to `chatlog.txt`  
✅ Auto-save received files in `received/` folder  
✅ `/help` command for ease of use  
✅ Works on both Windows and macOS (cross-platform)  
✅ Web interface and CLI client  

## Installation

1. Install dependencies:
```bash
pnpm install
```

2. Build the application:
```bash
pnpm build
```

## 🚀 Usage

### Start the Server
```bash
npm run dev
# or for production
npm start
```

### CLI Client
```bash
npm run client
# or connect to specific server
npm run client ws://[SERVER_IP]:3001
```

### Web Interface
Open your browser and go to:
```
http://localhost:3001
```

## Network Setup

For LAN usage, users need to connect to the server's IP address:
- Find server IP: `ipconfig` (Windows) or `ifconfig` (macOS/Linux)
- Clients connect to: `http://[SERVER_IP]:3001`

## Cross-Platform Compatibility

The application works on:
- Windows 10/11
- macOS
- Linux
- Any device with a web browser (web interface)

---

**Built with ❤️ using Hono, TypeScript, and WebSockets**
