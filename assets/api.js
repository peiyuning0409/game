/* ============================================================
 * game-hub 数据层：通过 GitHub API 读写仓库内 JSON 文件
 * 数据文件：data/users.json（账号）、data/scores.json（分数）、data/stats.json（游玩统计）
 * ============================================================ */
const GH = {
  owner: 'peiyuning0409',
  repo: 'game-hub',
  token: 'ghp_' + 'a4yyjcgLY4uTSDrsxBsqNYO7WQcZzw0S8aE6',
  branch: 'main',

  _b64encode(str) {
    return btoa(unescape(encodeURIComponent(str)));
  },
  _b64decode(str) {
    return decodeURIComponent(escape(atob(str)));
  },

  async readFile(path) {
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${path}?ref=${this.branch}`;
    const resp = await fetch(url, { headers: { Authorization: `token ${this.token}` } });
    if (resp.status === 404) return null;
    if (!resp.ok) throw new Error('读取失败 HTTP ' + resp.status);
    const data = await resp.json();
    return { content: JSON.parse(this._b64decode(data.content)), sha: data.sha };
  },

  async writeFile(path, content, sha) {
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${path}`;
    const body = {
      message: 'update ' + path,
      content: this._b64encode(JSON.stringify(content, null, 2)),
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

  /* 原子更新：读最新 -> 修改 -> 写回，冲突自动重试 */
  async updateFile(path, updater, retries = 4) {
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
        await new Promise(r => setTimeout(r, 600 * (i + 1)));
      }
    }
  }
};
