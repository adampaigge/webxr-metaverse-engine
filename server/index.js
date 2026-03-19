import { QuantumServer } from './distributed/QuantumServer.js';

const config = {
    port: process.env.PORT || 4433,
    host: process.env.HOST || '0.0.0.0',
    maxPlayersPerZone: 100,
    zoneSize: 100,
    enableSFU: true,
    sfuType: 'mediasoup',
    cert: process.env.SSL_CERT,
    privKey: process.env.SSL_KEY
};

const server = new QuantumServer(config);

await server.initialize();

console.log(`🌐 QuantumServer running on ${config.host}:${config.port}`);
console.log(`📡 Protocol: MVMP/1.0`);
console.log(`🎥 SFU: ${config.sfuType}`);

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('Shutting down...');
    // Cleanup
    process.exit(0);
});
