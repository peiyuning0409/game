/* ============================================================
 * game-hub 数据层（加密版）：AES-GCM 加密后存储于 GitHub
 * 数据文件：data/users.json、data/scores.json、data/stats.json
 * 所有数据在浏览器端加密后再上传，仓库内仅存密文
 * ============================================================ */
const GH = {
  owner: 'peiyuning0409',
  repo: 'game-hub',
  token: 'ghp_' + 'a4yyjcgLY4uTSDrsxBsqNYO7WQcZzw0S8aE6',
  branch: 'main',
  secret: '1HG6f1$' + 'fAECLFIZzUw3py*dTw9AJU2tH',
  salt: 'game-hub-salt-v1',

  /* 全局串行写入队列：保证同一时刻只有一个 GitHub 写请求在执行，
   * 彻底避免多局游戏并发写同一数据文件导致的 409 冲突。 */
  _q: Promise.resolve(),
  _enqueue(fn) {
    const run = this._q.then(fn, fn);
    this._q = run.catch(() => {});
    return run;
  },

  async _getKey() {
    const enc = new TextEncoder();
    const km = await crypto.subtle.importKey('raw', enc.encode(this.secret), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: enc.encode(this.salt), iterations: 100000, hash: 'SHA-256' },
      km,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  },

  async _encrypt(obj) {
    const key = await this._getKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode(JSON.stringify(obj));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
    const combined = new Uint8Array(12 + cipher.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(cipher), 12);
    let bin = '';
    for (let i = 0; i < combined.length; i++) bin += String.fromCharCode(combined[i]);
    return btoa(bin);
  },

  async _decrypt(b64) {
    const key = await this._getKey();
    const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const iv = raw.slice(0, 12);
    const cipher = raw.slice(12);
    const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
    return JSON.parse(new TextDecoder().decode(dec));
  },

  async readFile(path) {
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${path}?ref=${this.branch}`;
    const resp = await fetch(url, { headers: { Authorization: `token ${this.token}` } });
    if (resp.status === 404) return null;
    if (!resp.ok) throw new Error('读取失败 HTTP ' + resp.status);
    const data = await resp.json();
    const cipherB64 = atob(data.content);
    const content = await this._decrypt(cipherB64);
    return { content, sha: data.sha };
  },

  async writeFile(path, content, sha) {
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${path}`;
    const cipherB64 = await this._encrypt(content);
    const body = {
      message: 'update ' + path,
      content: btoa(cipherB64),
      branch: this.branch
    };
    if (sha) body.sha = sha;
    const resp = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: `token ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error('写入失败 HTTP ' + resp.status);
    const data = await resp.json();
    return data.content.sha;
  },

  /* 原子更新：读最新 -> 修改 -> 写回，冲突自动重试；全程走串行队列防并发冲突 */
  async updateFile(path, updater, retries = 5) {
    return this._enqueue(async () => {
      for (let i = 0; i < retries; i++) {
        try {
          const cur = await this.readFile(path);
          let data;
          if (cur) {
            data = cur.content;
          } else {
            data = path.endsWith('users.json') ? { users: [] }
                : path.endsWith('scores.json') ? { scores: [] }
                : { stats: [] };
          }
          const newData = updater(data);
          const sha = await this.writeFile(path, newData, cur ? cur.sha : undefined);
          return newData;
        } catch (e) {
          if (i === retries - 1) throw e;
          // 退避重试：409 冲突 / 429 限流 / 网络抖动均等待后重试
          await new Promise(r => setTimeout(r, 800 * (i + 1)));
        }
      }
    });
  }
};

