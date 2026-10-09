const request = require('supertest');
const createApp = require('../src/app');

describe('CORS restrito por CORS_ORIGINS', () => {
  const original = process.env.CORS_ORIGINS;

  beforeEach(() => {
    process.env.CORS_ORIGINS = 'http://localhost:5173, http://192.168.0.10:5173';
  });

  afterAll(() => {
    if (original === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = original;
  });

  it('origem listada em CORS_ORIGINS recebe Access-Control-Allow-Origin', async () => {
    const res = await request(createApp())
      .get('/health')
      .set('Origin', 'http://192.168.0.10:5173');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://192.168.0.10:5173');
  });

  it('origem nao listada nao recebe Access-Control-Allow-Origin', async () => {
    const res = await request(createApp())
      .get('/health')
      .set('Origin', 'http://malicioso.example');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('preflight com Access-Control-Request-Private-Network responde Access-Control-Allow-Private-Network true', async () => {
    const res = await request(createApp())
      .options('/api/vendas/faturamento')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Private-Network', 'true');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-private-network']).toBe('true');
  });

  it('CORS_ORIGINS vazia ou ausente nao libera origem cross-site', async () => {
    process.env.CORS_ORIGINS = '';
    const resVazia = await request(createApp()).get('/health').set('Origin', 'https://app.vercel.app');
    expect(resVazia.status).toBe(200);
    expect(resVazia.headers['access-control-allow-origin']).toBeUndefined();

    delete process.env.CORS_ORIGINS;
    const resAusente = await request(createApp()).get('/health').set('Origin', 'https://app.vercel.app');
    expect(resAusente.status).toBe(200);
    expect(resAusente.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('preflight Private Network de origem nao listada nao recebe Access-Control-Allow-Private-Network', async () => {
    const res = await request(createApp())
      .options('/api/vendas/faturamento')
      .set('Origin', 'http://malicioso.example')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Private-Network', 'true');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-allow-private-network']).toBeUndefined();
  });

  it('CORS_ORIGINS com barra final e espacos ainda libera a origem normalizada', async () => {
    process.env.CORS_ORIGINS = '  https://app.vercel.app/ , , http://localhost:5173/  ';
    const res = await request(createApp()).get('/health').set('Origin', 'https://app.vercel.app');
    expect(res.headers['access-control-allow-origin']).toBe('https://app.vercel.app');
  });
});
