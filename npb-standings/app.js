/**
 * NPB スタイル 順位表・対戦表 & 個人成績システム
 * 日本プロ野球公式ルール準拠
 * 1試合ごとの詳細試合結果 & 選手個人成績 (打率・防御率・OPS等自動計算) 管理対応
 */

class NPBStandingsApp {
  constructor() {
    this.STORAGE_KEY = 'npb_standings_app_state_v3';
    
    // 設定
    this.settings = {
      leagueName: 'ペナントレース 順位表',
      gamesPerMatch: 27, // 1カードあたりの最大試合数
      tiebreaker: 'central', // 'central' | 'pacific' | 'simple'
      syncMode: true // 試合記録から全体成績を自動集計するか
    };

    this.teams = [];
    this.matches = {}; // key: "id1_vs_id2" (常に辞書順昇順 id1 < id2)
    this.games = []; // 1試合ごとの個別試合記録リスト
    this.players = []; // 選手個人情報 & 成績データ
    this.lineups = {}; // key: teamId, value: { dh: bool, order: [{打順,選手名,守備位置,備考}] }
    this.selectedPlayerIds = new Set(); // チェック選沢中の選手 ID
    this.theme = 'dark';
    this.currentTab = 'standings'; // 'standings' | 'games' | 'players'
    this.currentPlayerSubtab = 'batting'; // 'batting' | 'pitching' | 'leaders' | 'lineup'
    this.selectedPlayerTeam = 'all';
    this.currentLineupTeamId = null; // 打順表の現在選択チーム
    this.lineupDHMode = false; // DHモード

    // 初期化
    this.init();
  }

  init() {
    this.loadFromStorage();
    if (!this.teams || this.teams.length === 0) {
      this.loadCentralLeaguePreset(false);
    }
    this.setupEventListeners();
    this.render();
    this.initVisitorCounter();
  }

  // ==========================================
  // イベントリスナー & DOM設定
  // ==========================================
  setupEventListeners() {
    // プリセットドロップダウン
    const presetBtn = document.getElementById('presetDropdownBtn');
    const presetMenu = document.getElementById('presetMenu');
    if (presetBtn && presetMenu) {
      presetBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        presetMenu.classList.toggle('show');
      });
      document.addEventListener('click', () => {
        presetMenu.classList.remove('show');
      });
    }

    // カラーピッカー同期
    const colorInput = document.getElementById('teamColorInput');
    const colorHex = document.getElementById('teamColorHex');
    if (colorInput && colorHex) {
      colorInput.addEventListener('input', (e) => {
        colorHex.value = e.target.value.toUpperCase();
      });
      colorHex.addEventListener('input', (e) => {
        if (/^#[0-9A-F]{6}$/i.test(e.target.value)) {
          colorInput.value = e.target.value;
        }
      });
    }

    // 全試合自動作成メニュー・まとめて削除メニューのトグル
    document.addEventListener('click', (e) => {
      const autoMenu = document.getElementById('autoGenerateMenu');
      if (autoMenu && !e.target.closest('#autoGenerateBtn')) {
        autoMenu.classList.remove('show');
      }
      const batchMenu = document.getElementById('batchDeleteMenu');
      if (batchMenu && !e.target.closest('#batchDeleteBtn')) {
        batchMenu.classList.remove('show');
      }
    });
  }

  toggleAutoGenerateMenu(event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('autoGenerateMenu');
    if (menu) menu.classList.toggle('show');
  }

  toggleBatchDeleteMenu(event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('batchDeleteMenu');
    if (menu) menu.classList.toggle('show');
  }

  // ==========================================
  // タブ切り替え
  // ==========================================
  switchTab(tabId) {
    this.currentTab = tabId;
    const tabStandingsBtn = document.getElementById('tabStandingsBtn');
    const tabGamesBtn = document.getElementById('tabGamesBtn');
    const tabPlayersBtn = document.getElementById('tabPlayersBtn');
    const paneStandings = document.getElementById('paneStandings');
    const paneGames = document.getElementById('paneGames');
    const panePlayers = document.getElementById('panePlayers');

    [tabStandingsBtn, tabGamesBtn, tabPlayersBtn].forEach(b => { if (b) b.classList.remove('active'); });
    [paneStandings, paneGames, panePlayers].forEach(p => { if (p) p.classList.remove('active'); });

    if (tabId === 'standings') {
      if (tabStandingsBtn) tabStandingsBtn.classList.add('active');
      if (paneStandings) paneStandings.classList.add('active');
    } else if (tabId === 'games') {
      if (tabGamesBtn) tabGamesBtn.classList.add('active');
      if (paneGames) paneGames.classList.add('active');
      this.renderGamesList();
    } else if (tabId === 'players') {
      if (tabPlayersBtn) tabPlayersBtn.classList.add('active');
      if (panePlayers) panePlayers.classList.add('active');
      this.renderPlayersSection();
    }
  }

  switchPlayerSubtab(subtabId) {
    this.currentPlayerSubtab = subtabId;
    this.selectedPlayerIds.clear();
    this.updateDeleteSelectedBtn();

    const btnB = document.getElementById('subtabBattingBtn');
    const btnP = document.getElementById('subtabPitchingBtn');
    const btnL = document.getElementById('subtabLeadersBtn');
    const btnLU = document.getElementById('subtabLineupBtn');
    const paneB = document.getElementById('subpaneBatting');
    const paneP = document.getElementById('subpanePitching');
    const paneL = document.getElementById('subpaneLeaders');
    const paneLU = document.getElementById('subpaneLineup');

    [btnB, btnP, btnL, btnLU].forEach(b => { if (b) b.classList.remove('active'); });
    [paneB, paneP, paneL, paneLU].forEach(p => { if (p) p.classList.remove('active'); });

    if (subtabId === 'batting') {
      if (btnB) btnB.classList.add('active');
      if (paneB) paneB.classList.add('active');
      this.renderBattingTable();
    } else if (subtabId === 'pitching') {
      if (btnP) btnP.classList.add('active');
      if (paneP) paneP.classList.add('active');
      this.renderPitchingTable();
    } else if (subtabId === 'leaders') {
      if (btnL) btnL.classList.add('active');
      if (paneL) paneL.classList.add('active');
      this.renderLeadersBoard();
    } else if (subtabId === 'lineup') {
      if (btnLU) btnLU.classList.add('active');
      if (paneLU) paneLU.classList.add('active');
      this.renderLineupSection();
    }
  }

  handlePlayerTeamChange() {
    const select = document.getElementById('playerTeamSelect');
    if (select) this.selectedPlayerTeam = select.value;
    this.renderPlayersSection();
  }

  // ==========================================
  // ストレージ保存 & 復元
  // ==========================================
  saveToStorage() {
    try {
      const state = {
        settings: this.settings,
        teams: this.teams,
        matches: this.matches,
        games: this.games,
        players: this.players,
        lineups: this.lineups,
        theme: this.theme
      };
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('LocalStorageへの保存に失敗しました:', e);
    }
  }

  loadFromStorage() {
    try {
      const saved = localStorage.getItem(this.STORAGE_KEY);
      if (saved) {
        const state = JSON.parse(saved);
        if (state.settings) this.settings = { ...this.settings, ...state.settings };
        if (state.teams) this.teams = state.teams;
        if (state.matches) this.matches = state.matches;
        if (state.games) this.games = state.games;
        if (state.players) this.players = state.players;
        if (state.lineups) this.lineups = state.lineups;
        if (state.theme) this.theme = state.theme;
        this.applyTheme();
      }
    } catch (e) {
      console.error('保存データの読み込みエラー:', e);
    }
  }

  // ==========================================
  // プリセットデータ
  // ==========================================
  loadPreset(presetType) {
    const presetMenu = document.getElementById('presetMenu');
    if (presetMenu) presetMenu.classList.remove('show');

    if (!confirm('現在のデータを破棄してプリセットを読み込みますか？')) return;

    if (presetType === 'central') {
      this.loadCentralLeaguePreset(true);
    } else if (presetType === 'pacific') {
      this.loadPacificLeaguePreset(true);
    } else if (presetType === 'twelve') {
      this.load12TeamsPreset(true);
    } else if (presetType === 'four') {
      this.load4TeamsPreset(true);
    } else if (presetType === 'empty') {
      this.teams = [];
      this.matches = {};
      this.games = [];
      this.players = [];
      this.settings.leagueName = '新規リーグ';
      this.saveToStorage();
      this.render();
    }
  }

  loadCentralLeaguePreset(shouldRender = true) {
    this.settings.leagueName = 'セ・リーグ公式戦';
    this.settings.tiebreaker = 'central';
    this.settings.gamesPerMatch = 27;
    this.teams = [
      { id: 't_g', name: '読売ジャイアンツ', shortName: '巨人', color: '#F97711', icon: 'G', manualStats: { wins: 0, losses: 0, draws: 0, runs: 0, runsAgainst: 0 } },
      { id: 't_t', name: '阪神タイガース', shortName: '阪神', color: '#FFE100', icon: 'T', manualStats: { wins: 0, losses: 0, draws: 0, runs: 0, runsAgainst: 0 } },
      { id: 't_db', name: '横浜DeNAベイスターズ', shortName: 'DeNA', color: '#0055A5', icon: 'DB', manualStats: { wins: 0, losses: 0, draws: 0, runs: 0, runsAgainst: 0 } },
      { id: 't_c', name: '広島東洋カープ', shortName: '広島', color: '#FF0000', icon: 'C', manualStats: { wins: 0, losses: 0, draws: 0, runs: 0, runsAgainst: 0 } },
      { id: 't_s', name: '東京ヤクルトスワローズ', shortName: 'ヤクルト', color: '#00B16B', icon: 'S', manualStats: { wins: 0, losses: 0, draws: 0, runs: 0, runsAgainst: 0 } },
      { id: 't_d', name: '中日ドラゴンズ', shortName: '中日', color: '#002B66', icon: 'D', manualStats: { wins: 0, losses: 0, draws: 0, runs: 0, runsAgainst: 0 } }
    ];

    this.matches = {};
    this.games = [];

    // 実在スター選手のプリセット登録
    this.players = [
      // 巨人
      { id: 'p_g1', teamId: 't_g', number: 25, name: '岡本 和真', position: '内野手', throwsBats: '右投右打', type: 'batting', batting: { g: 140, pa: 580, ab: 500, r: 75, h: 140, b2: 30, b3: 1, hr: 27, rbi: 83, sb: 1, cs: 0, bb: 70, hbp: 6, so: 105, sh: 0, sf: 4, gdp: 12 } },
      { id: 'p_g2', teamId: 't_g', number: 6, name: '坂本 勇人', position: '内野手', throwsBats: '右投右打', type: 'batting', batting: { g: 125, pa: 490, ab: 430, r: 52, h: 124, b2: 24, b3: 0, hr: 16, rbi: 60, sb: 2, cs: 1, bb: 55, hbp: 2, so: 80, sh: 1, sf: 2, gdp: 9 } },
      { id: 'p_g3', teamId: 't_g', number: 2, name: '吉川 尚輝', position: '内野手', throwsBats: '右投左打', type: 'batting', batting: { g: 143, pa: 590, ab: 530, r: 68, h: 152, b2: 25, b3: 3, hr: 5, rbi: 46, sb: 12, cs: 4, bb: 45, hbp: 3, so: 68, sh: 9, sf: 3, gdp: 5 } },
      { id: 'p_g4', teamId: 't_g', number: 20, name: '戸郷 翔征', position: '投手', throwsBats: '右投右打', type: 'pitching', pitching: { g: 26, gs: 26, cg: 4, sho: 3, w: 12, l: 8, sv: 0, hld: 0, ip: 180.0, h: 140, hr: 11, bb: 44, hbp: 6, so: 156, r: 48, er: 39 } },
      { id: 'p_g5', teamId: 't_g', number: 15, name: '大勢', position: '投手', throwsBats: '右投右打', type: 'pitching', pitching: { g: 45, gs: 0, cg: 0, sho: 0, w: 1, l: 2, sv: 29, hld: 6, ip: 43.1, h: 28, hr: 2, bb: 10, hbp: 2, so: 54, r: 8, er: 7 } },

      // 阪神
      { id: 'p_t1', teamId: 't_t', number: 8, name: '佐藤 輝明', position: '内野手', throwsBats: '右投左打', type: 'batting', batting: { g: 138, pa: 560, ab: 490, r: 66, h: 133, b2: 28, b3: 4, hr: 24, rbi: 78, sb: 6, cs: 2, bb: 58, hbp: 5, so: 135, sh: 0, sf: 3, gdp: 8 } },
      { id: 'p_t2', teamId: 't_t', number: 3, name: '大山 悠輔', position: '内野手', throwsBats: '右投右打', type: 'batting', batting: { g: 142, pa: 590, ab: 500, r: 64, h: 129, b2: 22, b3: 0, hr: 14, rbi: 68, sb: 1, cs: 0, bb: 79, hbp: 6, so: 92, sh: 0, sf: 5, gdp: 14 } },
      { id: 'p_t3', teamId: 't_t', number: 1, name: '森下 翔太', position: '外野手', throwsBats: '右投右打', type: 'batting', batting: { g: 130, pa: 520, ab: 460, r: 60, h: 126, b2: 24, b3: 2, hr: 16, rbi: 73, sb: 2, cs: 1, bb: 50, hbp: 5, so: 85, sh: 1, sf: 4, gdp: 10 } },
      { id: 'p_t4', teamId: 't_t', number: 35, name: '才木 浩人', position: '投手', throwsBats: '右投右打', type: 'pitching', pitching: { g: 25, gs: 25, cg: 4, sho: 3, w: 13, l: 3, sv: 0, hld: 0, ip: 167.2, h: 126, hr: 6, bb: 39, hbp: 4, so: 137, r: 38, er: 34 } },
      { id: 'p_t5', teamId: 't_t', number: 13, name: '岩崎 優', position: '投手', throwsBats: '左投左打', type: 'pitching', pitching: { g: 50, gs: 0, cg: 0, sho: 0, w: 4, l: 4, sv: 23, hld: 14, ip: 47.0, h: 36, hr: 3, bb: 11, hbp: 1, so: 45, r: 12, er: 11 } },

      // DeNA
      { id: 'p_db1', teamId: 't_db', number: 2, name: '牧 秀悟', position: '内野手', throwsBats: '右投右打', type: 'batting', batting: { g: 135, pa: 560, ab: 500, r: 72, h: 147, b2: 33, b3: 1, hr: 23, rbi: 74, sb: 10, cs: 3, bb: 48, hbp: 6, so: 78, sh: 0, sf: 6, gdp: 15 } },
      { id: 'p_db2', teamId: 't_db', number: 3, name: 'オースティン', position: '内野手', throwsBats: '右投右打', type: 'batting', batting: { g: 106, pa: 420, ab: 365, r: 50, h: 115, b2: 25, b3: 0, hr: 25, rbi: 69, sb: 1, cs: 0, bb: 47, hbp: 5, so: 82, sh: 0, sf: 3, gdp: 6 } },
      { id: 'p_db3', teamId: 't_db', number: 51, name: '宮﨑 敏郎', position: '内野手', throwsBats: '右投右打', type: 'batting', batting: { g: 120, pa: 460, ab: 410, r: 40, h: 126, b2: 26, b3: 1, hr: 14, rbi: 56, sb: 0, cs: 0, bb: 42, hbp: 4, so: 40, sh: 0, sf: 4, gdp: 11 } },
      { id: 'p_db4', teamId: 't_db', number: 11, name: '東 克樹', position: '投手', throwsBats: '左投左打', type: 'pitching', pitching: { g: 26, gs: 26, cg: 3, sho: 1, w: 13, l: 4, sv: 0, hld: 0, ip: 183.0, h: 155, hr: 10, bb: 26, hbp: 4, so: 140, r: 49, er: 44 } },

      // ヤクルト
      { id: 'p_s1', teamId: 't_s', number: 55, name: '村上 宗隆', position: '内野手', throwsBats: '右投左打', type: 'batting', batting: { g: 143, pa: 610, ab: 495, r: 82, h: 121, b2: 25, b3: 2, hr: 33, rbi: 86, sb: 10, cs: 3, bb: 104, hbp: 6, so: 180, sh: 0, sf: 5, gdp: 10 } },
      { id: 'p_s2', teamId: 't_s', number: 25, name: 'サンタナ', position: '外野手', throwsBats: '右投右打', type: 'batting', batting: { g: 125, pa: 500, ab: 430, r: 52, h: 135, b2: 26, b3: 0, hr: 17, rbi: 66, sb: 1, cs: 0, bb: 60, hbp: 5, so: 95, sh: 0, sf: 5, gdp: 13 } },

      // 中日
      { id: 'p_d1', teamId: 't_d', number: 55, name: '細川 成也', position: '外野手', throwsBats: '右投右打', type: 'batting', batting: { g: 143, pa: 590, ab: 510, r: 64, h: 149, b2: 30, b3: 0, hr: 23, rbi: 67, sb: 1, cs: 1, bb: 68, hbp: 7, so: 130, sh: 0, sf: 5, gdp: 11 } },
      { id: 'p_d2', teamId: 't_d', number: 19, name: '髙橋 宏斗', position: '投手', throwsBats: '右投右打', type: 'pitching', pitching: { g: 21, gs: 21, cg: 1, sho: 1, w: 12, l: 4, sv: 0, hld: 0, ip: 143.2, h: 98, hr: 1, bb: 34, hbp: 2, so: 130, r: 23, er: 22 } }
    ];

    // 全体スケジュールも自動作成
    this.generateAllScheduleInternal(true, false);

    this.saveToStorage();
    if (shouldRender) this.render();
  }

  loadPacificLeaguePreset(shouldRender = true) {
    this.settings.leagueName = 'パ・リーグ公式戦';
    this.settings.tiebreaker = 'pacific';
    this.settings.gamesPerMatch = 27;
    this.teams = [
      { id: 't_h', name: '福岡ソフトバンクホークス', shortName: 'ソフトバンク', color: '#FCC800', icon: 'H', manualStats: { wins: 0, losses: 0, draws: 0, runs: 0, runsAgainst: 0 } },
      { id: 't_f', name: '北海道日本ハムファイターズ', shortName: '日本ハム', color: '#0070B8', icon: 'F', manualStats: { wins: 0, losses: 0, draws: 0, runs: 0, runsAgainst: 0 } },
      { id: 't_m', name: '千葉ロッテマリーンズ', shortName: 'ロッテ', color: '#222222', icon: 'M', manualStats: { wins: 0, losses: 0, draws: 0, runs: 0, runsAgainst: 0 } },
      { id: 't_b', name: 'オリックス・バファローズ', shortName: 'オリックス', color: '#1B2C4D', icon: 'B', manualStats: { wins: 0, losses: 0, draws: 0, runs: 0, runsAgainst: 0 } },
      { id: 't_e', name: '東北楽天ゴールデンイーグルス', shortName: '楽天', color: '#860010', icon: 'E', manualStats: { wins: 0, losses: 0, draws: 0, runs: 0, runsAgainst: 0 } },
      { id: 't_l', name: '埼玉西武ライオンズ', shortName: '西武', color: '#133560', icon: 'L', manualStats: { wins: 0, losses: 0, draws: 0, runs: 0, runsAgainst: 0 } }
    ];
    this.matches = {};
    this.games = [];
    this.players = [
      { id: 'p_h1', teamId: 't_h', number: 25, name: '山川 穂高', position: '内野手', throwsBats: '右投右打', type: 'batting', batting: { g: 143, pa: 600, ab: 510, r: 76, h: 126, b2: 24, b3: 0, hr: 34, rbi: 99, sb: 0, cs: 0, bb: 78, hbp: 6, so: 145, sh: 0, sf: 6, gdp: 16 } },
      { id: 'p_h2', teamId: 't_h', number: 3, name: '近藤 健介', position: '外野手', throwsBats: '右投左打', type: 'batting', batting: { g: 129, pa: 540, ab: 440, r: 75, h: 138, b2: 30, b3: 2, hr: 19, rbi: 72, sb: 11, cs: 2, bb: 92, hbp: 4, so: 95, sh: 0, sf: 4, gdp: 8 } },
      { id: 'p_h3', teamId: 't_h', number: 18, name: '有原 航平', position: '投手', throwsBats: '右投右打', type: 'pitching', pitching: { g: 26, gs: 26, cg: 3, sho: 1, w: 14, l: 7, sv: 0, hld: 0, ip: 182.0, h: 158, hr: 12, bb: 38, hbp: 5, so: 137, r: 54, er: 48 } },
      { id: 'p_f1', teamId: 't_f', number: 66, name: '万波 中正', position: '外野手', throwsBats: '右投右打', type: 'batting', batting: { g: 136, pa: 550, ab: 490, r: 60, h: 124, b2: 25, b3: 2, hr: 18, rbi: 60, sb: 5, cs: 2, bb: 48, hbp: 7, so: 130, sh: 1, sf: 4, gdp: 9 } },
      { id: 'p_f2', teamId: 't_f', number: 17, name: '伊藤 大海', position: '投手', throwsBats: '右投左打', type: 'pitching', pitching: { g: 26, gs: 26, cg: 5, sho: 1, w: 14, l: 5, sv: 0, hld: 0, ip: 176.1, h: 144, hr: 11, bb: 38, hbp: 3, so: 161, r: 56, er: 52 } }
    ];

    this.generateAllScheduleInternal(true, false);

    this.saveToStorage();
    if (shouldRender) this.render();
  }

  load12TeamsPreset(shouldRender = true) {
    this.settings.leagueName = 'NPB 12球団リーグ';
    this.settings.tiebreaker = 'central';
    this.settings.gamesPerMatch = 27;
    this.teams = [
      { id: 't_g', name: '読売ジャイアンツ', shortName: '巨人', color: '#F97711', icon: 'G' },
      { id: 't_t', name: '阪神タイガース', shortName: '阪神', color: '#FFE100', icon: 'T' },
      { id: 't_db', name: '横浜DeNAベイスターズ', shortName: 'DeNA', color: '#0055A5', icon: 'DB' },
      { id: 't_c', name: '広島東洋カープ', shortName: '広島', color: '#FF0000', icon: 'C' },
      { id: 't_s', name: '東京ヤクルトスワローズ', shortName: 'ヤクルト', color: '#00B16B', icon: 'S' },
      { id: 't_d', name: '中日ドラゴンズ', shortName: '中日', color: '#002B66', icon: 'D' },
      { id: 't_h', name: '福岡ソフトバンクホークス', shortName: 'ソフトバンク', color: '#FCC800', icon: 'H' },
      { id: 't_f', name: '北海道日本ハムファイターズ', shortName: '日本ハム', color: '#0070B8', icon: 'F' },
      { id: 't_m', name: '千葉ロッテマリーンズ', shortName: 'ロッテ', color: '#222222', icon: 'M' },
      { id: 't_b', name: 'オリックス・バファローズ', shortName: 'オリックス', color: '#1B2C4D', icon: 'B' },
      { id: 't_e', name: '東北楽天ゴールデンイーグルス', shortName: '楽天', color: '#860010', icon: 'E' },
      { id: 't_l', name: '埼玉西武ライオンズ', shortName: '西武', color: '#133560', icon: 'L' }
    ];
    this.matches = {};
    this.games = [];
    this.players = [];
    this.saveToStorage();
    if (shouldRender) this.render();
  }

  load4TeamsPreset(shouldRender = true) {
    this.settings.leagueName = '4チーム チャレンジリーグ';
    this.settings.tiebreaker = 'central';
    this.settings.gamesPerMatch = 27;
    this.teams = [
      { id: 't_1', name: 'レッドサンダース', shortName: '赤雷', color: '#EF4444', icon: 'R' },
      { id: 't_2', name: 'ブルードルフィンズ', shortName: '青海', color: '#3B82F6', icon: 'B' },
      { id: 't_3', name: 'グリーンフォレスト', shortName: '緑森', color: '#10B981', icon: 'G' },
      { id: 't_4', name: 'イエローバイパーズ', shortName: '黄蛇', color: '#F59E0B', icon: 'Y' }
    ];
    this.matches = {};
    this.games = [];
    this.players = [];
    this.saveToStorage();
    if (shouldRender) this.render();
  }

  // ==========================================
  // 全試合一括自動作成
  // ==========================================
  generateAllSchedule(withSimulation = false) {
    const menu = document.getElementById('autoGenerateMenu');
    if (menu) menu.classList.remove('show');

    if (this.teams.length < 2) {
      alert('全試合を作成するには、チームが2つ以上登録されている必要があります。');
      return;
    }

    const totalMatchesPerCard = this.settings.gamesPerMatch;
    const numCards = (this.teams.length * (this.teams.length - 1)) / 2;
    const totalGamesCount = numCards * totalMatchesPerCard;

    const confirmMsg = withSimulation
      ? `【シミュレート自動生成】\n全${this.teams.length}チーム（計${totalGamesCount}試合）のリアルな試合スコア・投手・本塁打を一括生成しますか？\n（※既存の試合記録は上書きされます）`
      : `【未消化日程枠の自動生成】\n全${this.teams.length}チームの全${totalGamesCount}試合（各カード${totalMatchesPerCard}回戦）の日程枠を一括作成しますか？\n（※後から1試合ずつ結果を入力できます）`;

    if (!confirm(confirmMsg)) return;

    this.generateAllScheduleInternal(withSimulation, true);
  }

  generateAllScheduleInternal(withSimulation = false, showAlert = true) {
    const totalMatchesPerCard = this.settings.gamesPerMatch;
    const stadiumDict = {
      '巨人': '東京ドーム', '読売ジャイアンツ': '東京ドーム',
      '阪神': '甲子園', '阪神タイガース': '甲子園',
      'DeNA': '横浜スタジアム', '横浜DeNAベイスターズ': '横浜スタジアム',
      '広島': 'マツダスタジアム', '広島東洋カープ': 'マツダスタジアム',
      'ヤクルト': '神宮球場', '東京ヤクルトスワローズ': '神宮球場',
      '中日': 'バンテリンドーム', '中日ドラゴンズ': 'バンテリンドーム',
      'ソフトバンク': 'PayPayドーム', '福岡ソフトバンクホークス': 'PayPayドーム',
      '日本ハム': 'エスコンフィールド', '北海道日本ハムファイターズ': 'エスコンフィールド',
      'ロッテ': 'ZOZOマリン', '千葉ロッテマリーンズ': 'ZOZOマリン',
      'オリックス': '京セラドーム', 'オリックス・バファローズ': '京セラドーム',
      '楽天': '楽天モバイルパーク', '東北楽天ゴールデンイーグルス': '楽天モバイルパーク',
      '西武': 'ベルーナドーム', '埼玉西武ライオンズ': 'ベルーナドーム'
    };

    const pitchersDict = {
      '巨人': ['戸郷', '山﨑伊', '菅野', 'グリフィン', '赤星', '井上'],
      '阪神': ['才木', '村上', '大竹', '伊藤将', '西勇', 'ビーズリー'],
      'DeNA': ['東', 'ジャクソン', 'ケイ', '大貫', '平良', '森唯'],
      '広島': ['床田', '大瀬良', '森下', '九里', 'アドゥワ', '玉村'],
      'ヤクルト': ['吉村', '高橋奎', 'サイスニード', 'ヤフーレ', '小川', '奥川'],
      '中日': ['髙橋宏', '小笠原', '柳', 'メヒア', '大野', '松木平'],
      'ソフトバンク': ['有原', 'モイネロ', 'スチュワート', '大津', '大関', '和田'],
      '日本ハム': ['伊藤大', '山﨑福', '加藤貴', '金村', '北山', '福島'],
      'ロッテ': ['小島', '種市', '佐々木朗', '西野', 'カイケル', 'メルセデス'],
      'オリックス': ['宮城', 'エスピノーザ', '田嶋', 'カスティーヨ', '東', '曽谷'],
      '楽天': ['早川', '藤井', '内', '岸', '古謝', '瀧中'],
      '西武': ['今井', '隅田', '武内', '高橋光', '松本航', '渡邉']
    };

    const closersDict = {
      '巨人': '大勢', '阪神': '岩崎', 'DeNA': '森原', '広島': '栗林', 'ヤクルト': '田口', '中日': 'マルティネス',
      'ソフトバンク': 'オスナ', '日本ハム': '田中正', 'ロッテ': '益田', 'オリックス': 'マチャド', '楽天': '則本', '西武': 'アブレイユ'
    };

    const sluggersDict = {
      '巨人': ['岡本', '坂本', '丸', '吉川', '大城'],
      '阪神': ['佐藤輝', '大山', '森下', '近本', '中野'],
      'DeNA': ['牧', 'オースティン', '宮﨑', '佐野', '筒香'],
      '広島': ['小園', '坂倉', '末包', '野間', '堂林'],
      'ヤクルト': ['村上', '山田', 'サンタナ', 'オスナ', '長岡'],
      '中日': ['細川', '中田', '石川昂', 'カリステ', '福永'],
      'ソフトバンク': ['山川', '近藤', '柳田', '栗原', '今宮'],
      '日本ハム': ['レイエス', '万波', '清宮', 'マルティネス', '野村'],
      'ロッテ': ['ポランコ', 'ソト', '藤原', '中村奨', '安田'],
      'オリックス': ['杉本', '紅林', '森', '西川', '中川'],
      '楽天': ['浅村', '辰己', '小郷', '村林', '阿部'],
      '西武': ['外崎', '佐藤龍', '源田', '岸', '西川']
    };

    const newGames = [];
    const baseDate = new Date(2026, 2, 27);

    for (let i = 0; i < this.teams.length; i++) {
      for (let j = i + 1; j < this.teams.length; j++) {
        const teamA = this.teams[i];
        const teamB = this.teams[j];

        const stadiumA = stadiumDict[teamA.shortName] || stadiumDict[teamA.name] || `${teamA.shortName}球場`;
        const stadiumB = stadiumDict[teamB.shortName] || stadiumDict[teamB.name] || `${teamB.shortName}球場`;
        const pitchersA = pitchersDict[teamA.shortName] || ['先発A1', '先発A2', '先発A3'];
        const pitchersB = pitchersDict[teamB.shortName] || ['先発B1', '先発B2', '先発B3'];
        const closerA = closersDict[teamA.shortName] || '抑えA';
        const closerB = closersDict[teamB.shortName] || '抑えB';
        const sluggersA = sluggersDict[teamA.shortName] || ['打者A1', '打者A2'];
        const sluggersB = sluggersDict[teamB.shortName] || ['打者B1', '打者B2'];

        for (let r = 1; r <= totalMatchesPerCard; r++) {
          const isAHome = Math.floor((r - 1) / 3) % 2 === 0;
          const homeTeam = isAHome ? teamA : teamB;
          const awayTeam = isAHome ? teamB : teamA;
          const stadium = isAHome ? stadiumA : stadiumB;

          const seriesIndex = Math.floor((r - 1) / 3);
          const dayInSeries = (r - 1) % 3;
          const gameDate = new Date(baseDate);
          gameDate.setDate(baseDate.getDate() + (seriesIndex * 7) + dayInSeries + (i * 2));
          const dateStr = gameDate.toISOString().slice(0, 10);

          let awayScore = 0;
          let homeScore = 0;
          let awayStarter = '';
          let homeStarter = '';
          let winPitcher = '';
          let losePitcher = '';
          let savePitcher = '';
          let homeRuns = '';
          let notes = '';

          if (withSimulation) {
            const baseScoreA = Math.floor(Math.random() * 5);
            const baseScoreB = Math.floor(Math.random() * 5);
            const extra = Math.random() < 0.3 ? Math.floor(Math.random() * 4) : 0;
            
            awayScore = isAHome ? baseScoreB : (baseScoreA + extra);
            homeScore = isAHome ? (baseScoreA + extra) : baseScoreB;

            if (awayScore === homeScore && Math.random() > 0.08) {
              if (Math.random() > 0.5) homeScore += 1;
              else awayScore += 1;
            }

            const homePList = isAHome ? pitchersA : pitchersB;
            const awayPList = isAHome ? pitchersB : pitchersA;
            homeStarter = homePList[(r - 1) % homePList.length];
            awayStarter = awayPList[(r - 1) % awayPList.length];

            const homeCloser = isAHome ? closerA : closerB;
            const awayCloser = isAHome ? closerB : closerA;
            const homeSluggers = isAHome ? sluggersA : sluggersB;
            const awaySluggers = isAHome ? sluggersB : sluggersA;

            if (homeScore > awayScore) {
              winPitcher = `${homeStarter}`;
              losePitcher = `${awayStarter}`;
              if (homeScore - awayScore <= 3 && Math.random() > 0.3) savePitcher = `${homeCloser}`;
              notes = homeScore - awayScore === 1 ? '1点差の接戦' : '';
            } else if (awayScore > homeScore) {
              winPitcher = `${awayStarter}`;
              losePitcher = `${homeStarter}`;
              if (awayScore - homeScore <= 3 && Math.random() > 0.3) savePitcher = `${awayCloser}`;
              notes = awayScore - homeScore >= 5 ? `${awayTeam.shortName}打線爆発` : '';
            } else {
              notes = '延長12回引き分け';
            }

            const hrList = [];
            if (Math.random() > 0.4) {
              const s1 = homeSluggers[Math.floor(Math.random() * homeSluggers.length)];
              hrList.push(`${s1}${Math.floor(Math.random() * 25 + 1)}号(${homeTeam.shortName})`);
            }
            if (Math.random() > 0.4) {
              const s2 = awaySluggers[Math.floor(Math.random() * awaySluggers.length)];
              hrList.push(`${s2}${Math.floor(Math.random() * 25 + 1)}号(${awayTeam.shortName})`);
            }
            homeRuns = hrList.join(', ');
          }

          newGames.push({
            id: `game_${teamA.id}_${teamB.id}_r${r}`,
            round: r,
            date: dateStr,
            stadium: stadium,
            awayTeamId: awayTeam.id,
            homeTeamId: homeTeam.id,
            awayScore: awayScore,
            homeScore: homeScore,
            awayStarter: awayStarter,
            homeStarter: homeStarter,
            winPitcher: winPitcher,
            losePitcher: losePitcher,
            savePitcher: savePitcher,
            homeRuns: homeRuns,
            notes: notes
          });
        }
      }
    }

    this.games = newGames;
    this.saveToStorage();
    this.render();
    if (showAlert) alert(`全${this.teams.length}チーム・計${newGames.length}試合を一括作成しました！`);
  }

  // ==========================================
  // 選手個人成績 計算ヘルパー
  // ==========================================
  calcBattingStats(b) {
    const ab = b.ab || 0;
    const h = b.h || 0;
    const b2 = b.b2 || 0;
    const b3 = b.b3 || 0;
    const hr = b.hr || 0;
    const bb = b.bb || 0;
    const hbp = b.hbp || 0;
    const sf = b.sf || 0;

    // 単打
    const b1 = Math.max(0, h - (b2 + b3 + hr));
    // 塁打
    const tb = b1 + (b2 * 2) + (b3 * 3) + (hr * 4);

    // 打率 (AVG)
    const avg = ab > 0 ? (h / ab) : 0;
    // 出塁率 (OBP)
    const obpDenom = ab + bb + hbp + sf;
    const obp = obpDenom > 0 ? ((h + bb + hbp) / obpDenom) : 0;
    // 長打率 (SLG)
    const slg = ab > 0 ? (tb / ab) : 0;
    // OPS
    const ops = obp + slg;

    return {
      ...b,
      b1,
      tb,
      avg,
      obp,
      slg,
      ops,
      avgStr: avg >= 1.0 ? '1.000' : (avg === 0 ? '.000' : avg.toFixed(3).substring(1)),
      obpStr: obp >= 1.0 ? '1.000' : (obp === 0 ? '.000' : obp.toFixed(3).substring(1)),
      slgStr: slg >= 1.0 ? '1.000' : (slg === 0 ? '.000' : slg.toFixed(3).substring(1)),
      opsStr: ops.toFixed(3)
    };
  }

  calcPitchingStats(p) {
    const rawIp = parseFloat(p.ip) || 0;
    // 投球回数の小数部 (例: 145.2 -> 145 + 2/3)
    const ipInt = Math.floor(rawIp);
    const ipFrac = Math.round((rawIp - ipInt) * 10);
    const actualIp = ipInt + (ipFrac === 1 ? (1/3) : (ipFrac === 2 ? (2/3) : 0));

    const er = p.er || 0;
    const w = p.w || 0;
    const l = p.l || 0;
    const h = p.h || 0;
    const bb = p.bb || 0;
    const so = p.so || 0;

    // 防御率 (ERA)
    const era = actualIp > 0 ? ((er * 9) / actualIp) : 0;
    // 勝率 (WPCT)
    const wpct = (w + l) > 0 ? (w / (w + l)) : 0;
    // WHIP
    const whip = actualIp > 0 ? ((h + bb) / actualIp) : 0;
    // K/9 (奪三振率)
    const k9 = actualIp > 0 ? ((so * 9) / actualIp) : 0;
    // K/BB
    const kbb = bb > 0 ? (so / bb) : so;

    return {
      ...p,
      actualIp,
      era,
      wpct,
      whip,
      k9,
      kbb,
      eraStr: era.toFixed(2),
      wpctStr: wpct >= 1.0 ? '1.000' : (wpct === 0 ? '.000' : wpct.toFixed(3).substring(1)),
      whipStr: whip.toFixed(2),
      k9Str: k9.toFixed(2),
      kbbStr: kbb.toFixed(2)
    };
  }

  // ==========================================
  // マッチデータヘルパー & 試合集計
  // ==========================================
  getMatchKey(id1, id2) {
    return id1 < id2 ? `${id1}_vs_${id2}` : `${id2}_vs_${id1}`;
  }

  getMatchRecord(id1, id2) {
    const key = this.getMatchKey(id1, id2);
    
    const cardGames = this.games.filter(g =>
      ((g.awayTeamId === id1 && g.homeTeamId === id2) ||
       (g.awayTeamId === id2 && g.homeTeamId === id1)) &&
      g.isResultEntered === true  // 結果が入力済みの試合のみ集計
    );

    if (cardGames.length > 0) {
      let id1Wins = 0;
      let id2Wins = 0;
      let draws = 0;
      let id1Runs = 0;
      let id2Runs = 0;

      cardGames.forEach(g => {
        const isId1Home = g.homeTeamId === id1;
        const s1 = isId1Home ? g.homeScore : g.awayScore;
        const s2 = isId1Home ? g.awayScore : g.homeScore;

        id1Runs += s1;
        id2Runs += s2;

        if (s1 > s2) id1Wins++;
        else if (s2 > s1) id2Wins++;
        else draws++;
      });

      return {
        wins: id1Wins,
        losses: id2Wins,
        draws: draws,
        runs: id1Runs,
        runsAgainst: id2Runs,
        totalGames: id1Wins + id2Wins + draws
      };
    }

    const raw = this.matches[key] || {
      teamAId: id1 < id2 ? id1 : id2,
      teamBId: id1 < id2 ? id2 : id1,
      aWins: 0,
      bWins: 0,
      draws: 0,
      aRuns: 0,
      bRuns: 0
    };

    if (id1 < id2) {
      return {
        wins: raw.aWins,
        losses: raw.bWins,
        draws: raw.draws,
        runs: raw.aRuns,
        runsAgainst: raw.bRuns,
        totalGames: raw.aWins + raw.bWins + raw.draws
      };
    } else {
      return {
        wins: raw.bWins,
        losses: raw.aWins,
        draws: raw.draws,
        runs: raw.bRuns,
        runsAgainst: raw.aRuns,
        totalGames: raw.aWins + raw.bWins + raw.draws
      };
    }
  }

  saveMatchRecord(id1, id2, wins, losses, draws, runs, runsAgainst) {
    const key = this.getMatchKey(id1, id2);
    const isDirect = id1 < id2;
    this.matches[key] = {
      teamAId: isDirect ? id1 : id2,
      teamBId: isDirect ? id2 : id1,
      aWins: isDirect ? wins : losses,
      bWins: isDirect ? losses : wins,
      draws: draws,
      aRuns: isDirect ? runs : runsAgainst,
      bRuns: isDirect ? runsAgainst : runs
    };
    this.saveToStorage();
    this.render();
  }

  // ==========================================
  // NPB順位ソート & 成績計算
  // ==========================================
  calculateTeamStats(team) {
    if (this.settings.syncMode) {
      let wins = 0;
      let losses = 0;
      let draws = 0;
      let runs = 0;
      let runsAgainst = 0;

      for (const opponent of this.teams) {
        if (opponent.id === team.id) continue;
        const rec = this.getMatchRecord(team.id, opponent.id);
        wins += rec.wins;
        losses += rec.losses;
        draws += rec.draws;
        runs += rec.runs;
        runsAgainst += rec.runsAgainst;
      }

      const games = wins + losses + draws;
      const pct = (wins + losses) > 0 ? (wins / (wins + losses)) : 0;
      const diff = runs - runsAgainst;
      const margin = wins - losses;
      const maxPossibleGames = (this.teams.length - 1) * this.settings.gamesPerMatch;
      const remainingGames = Math.max(0, maxPossibleGames - games);

      return {
        ...team,
        games,
        wins,
        losses,
        draws,
        runs,
        runsAgainst,
        pct,
        diff,
        margin,
        remainingGames,
        maxPossibleGames
      };
    } else {
      const m = team.manualStats || { wins: 0, losses: 0, draws: 0, runs: 0, runsAgainst: 0 };
      const games = (m.wins || 0) + (m.losses || 0) + (m.draws || 0);
      const pct = (m.wins + m.losses) > 0 ? (m.wins / (m.wins + m.losses)) : 0;
      const diff = (m.runs || 0) - (m.runsAgainst || 0);
      const margin = (m.wins || 0) - (m.losses || 0);
      const maxPossibleGames = (this.teams.length - 1) * this.settings.gamesPerMatch;
      const remainingGames = Math.max(0, maxPossibleGames - games);

      return {
        ...team,
        games,
        wins: m.wins || 0,
        losses: m.losses || 0,
        draws: m.draws || 0,
        runs: m.runs || 0,
        runsAgainst: m.runsAgainst || 0,
        pct,
        diff,
        margin,
        remainingGames,
        maxPossibleGames
      };
    }
  }

  compareTeamsNPB(a, b) {
    const pctDiff = b.pct - a.pct;
    if (Math.abs(pctDiff) > 0.00001) return pctDiff;

    if (this.settings.tiebreaker === 'central') {
      if (b.wins !== a.wins) return b.wins - a.wins;
      const h2h = this.getMatchRecord(a.id, b.id);
      const h2hPctA = (h2h.wins + h2h.losses) > 0 ? (h2h.wins / (h2h.wins + h2h.losses)) : 0;
      const h2hPctB = (h2h.losses + h2h.wins) > 0 ? (h2h.losses / (h2h.losses + h2h.wins)) : 0;
      if (Math.abs(h2hPctA - h2hPctB) > 0.00001) return h2hPctB - h2hPctA;
      if (b.diff !== a.diff) return b.diff - a.diff;
      if (b.runs !== a.runs) return b.runs - a.runs;
    } else if (this.settings.tiebreaker === 'pacific') {
      const h2h = this.getMatchRecord(a.id, b.id);
      const h2hPctA = (h2h.wins + h2h.losses) > 0 ? (h2h.wins / (h2h.wins + h2h.losses)) : 0;
      const h2hPctB = (h2h.losses + h2h.wins) > 0 ? (h2h.losses / (h2h.losses + h2h.wins)) : 0;
      if (Math.abs(h2hPctA - h2hPctB) > 0.00001) return h2hPctB - h2hPctA;
      if (b.diff !== a.diff) return b.diff - a.diff;
      if (b.runs !== a.runs) return b.runs - a.runs;
      if (b.wins !== a.wins) return b.wins - a.wins;
    } else {
      if (b.diff !== a.diff) return b.diff - a.diff;
      if (b.runs !== a.runs) return b.runs - a.runs;
      if (b.wins !== a.wins) return b.wins - a.wins;
    }

    return a.id.localeCompare(b.id);
  }

  getSortedStandings() {
    const calculated = this.teams.map(t => this.calculateTeamStats(t));
    calculated.sort((a, b) => this.compareTeamsNPB(a, b));

    const leader = calculated[0];

    return calculated.map((team, index) => {
      let gb = 0;
      let gbStr = '-';

      if (index > 0 && leader) {
        gb = ((leader.wins - team.wins) + (team.losses - leader.losses)) / 2;
        gbStr = gb % 1 === 0 ? gb.toString() : gb.toFixed(1);
      }

      let rankNumber = index + 1;
      let isTied = false;
      if (index > 0) {
        const prev = calculated[index - 1];
        if (Math.abs(team.pct - prev.pct) < 0.00001 &&
            team.wins === prev.wins &&
            team.losses === prev.losses &&
            team.diff === prev.diff &&
            team.runs === prev.runs) {
          isTied = true;
          rankNumber = prev.rankNumber || index;
        }
      }

      return {
        ...team,
        rank: rankNumber,
        isTied,
        gb,
        gbStr
      };
    });
  }

  // ==========================================
  // レンダリング (全体描画)
  // ==========================================
  render() {
    this.renderHeaderMeta();
    this.renderStandings();
    this.renderMatrix();
    this.renderSummaryStats();
    this.renderFilterOptions();
    if (this.currentTab === 'games') {
      this.renderGamesList();
    } else if (this.currentTab === 'players') {
      this.renderPlayersSection();
    }
  }

  renderHeaderMeta() {
    const leagueNameDisplay = document.getElementById('leagueNameDisplay');
    const teamCountDisplay = document.getElementById('teamCountDisplay');
    const gamesPerMatchDisplay = document.getElementById('gamesPerMatchDisplay');
    const maxGamesDisplay = document.getElementById('maxGamesDisplay');
    const tiebreakerRuleDisplay = document.getElementById('tiebreakerRuleDisplay');
    const syncModeToggle = document.getElementById('syncModeToggle');
    const totalGamesBadge = document.getElementById('totalGamesBadge');
    const totalPlayersBadge = document.getElementById('totalPlayersBadge');

    if (leagueNameDisplay) leagueNameDisplay.textContent = this.settings.leagueName;
    if (teamCountDisplay) teamCountDisplay.textContent = this.teams.length;
    if (gamesPerMatchDisplay) gamesPerMatchDisplay.textContent = this.settings.gamesPerMatch;

    const maxGames = (this.teams.length - 1) * this.settings.gamesPerMatch;
    if (maxGamesDisplay) maxGamesDisplay.textContent = Math.max(0, maxGames);

    if (tiebreakerRuleDisplay) {
      tiebreakerRuleDisplay.textContent = 
        this.settings.tiebreaker === 'central' ? 'セ・リーグ方式' :
        this.settings.tiebreaker === 'pacific' ? 'パ・リーグ方式' : 'シンプル方式';
    }

    if (syncModeToggle) syncModeToggle.checked = this.settings.syncMode;
    if (totalGamesBadge) totalGamesBadge.textContent = `${this.games.length} 試合`;
    if (totalPlayersBadge) totalPlayersBadge.textContent = `${this.players.length} 名`;
  }

  renderStandings() {
    const tbody = document.getElementById('standingsTableBody');
    if (!tbody) return;

    if (this.teams.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="15" style="padding: 3rem; color: var(--text-muted);">
            <i class="ph ph-baseball" style="font-size: 2rem; display: block; margin-bottom: 0.5rem;"></i>
            チームが登録されていません。「チーム追加」または「プリセット」からチームを作成してください。
          </td>
        </tr>
      `;
      return;
    }

    const standings = this.getSortedStandings();
    let html = '';

    standings.forEach(team => {
      const isAClass = team.rank <= 3;
      const rankClass = isAClass ? 'a-class-row' : 'b-class-row';
      const rankBadgeClass = team.rank === 1 ? 'rank-1' : (team.rank === 2 ? 'rank-2' : (team.rank === 3 ? 'rank-3' : 'rank-other'));

      const pctFormatted = team.pct >= 1.0 ? '1.000' : (team.pct === 0 ? '.000' : team.pct.toFixed(3).substring(1));

      let marginBadge = '';
      if (team.margin > 0) marginBadge = `<span class="margin-badge positive">+${team.margin}</span>`;
      else if (team.margin < 0) marginBadge = `<span class="margin-badge negative">${team.margin}</span>`;
      else marginBadge = `<span class="margin-badge even">±0</span>`;

      let diffFormatted = '';
      if (team.diff > 0) diffFormatted = `<span class="diff-positive">+${team.diff}</span>`;
      else if (team.diff < 0) diffFormatted = `<span class="diff-negative">${team.diff}</span>`;
      else diffFormatted = `<span class="diff-zero">0</span>`;

      const streakClass = team.margin >= 0 ? 'streak-win' : 'streak-lose';
      const streakIcon = team.margin >= 0 ? 'ph-trend-up' : 'ph-trend-down';
      const streakText = team.margin >= 0 ? '好調' : '苦戦';

      html += `
        <tr class="rank-row ${rankClass}">
          <td class="col-rank">
            <span class="rank-badge ${rankBadgeClass}">${team.isTied ? `T${team.rank}` : team.rank}</span>
          </td>
          <td class="col-team">
            <div class="team-cell-content">
              <div class="team-badge-circle" style="background-color: ${team.color || '#3b82f6'};">
                ${team.icon || team.shortName.charAt(0)}
              </div>
              <div class="team-name-group">
                <span class="team-name-main">${this.escapeHTML(team.name)}</span>
                <span class="team-name-short">${this.escapeHTML(team.shortName)}</span>
              </div>
            </div>
          </td>
          <td class="col-games stat-num">${team.games}</td>
          <td class="col-win stat-num" style="color: var(--color-win); font-weight:700;">${team.wins}</td>
          <td class="col-lose stat-num" style="color: var(--color-lose);">${team.losses}</td>
          <td class="col-draw stat-num" style="color: var(--text-muted);">${team.draws}</td>
          <td class="col-pct"><span class="stat-num">${pctFormatted}</span></td>
          <td class="col-gb"><span class="stat-num">${team.gbStr}</span></td>
          <td class="col-runs stat-num">${team.runs}</td>
          <td class="col-ra stat-num">${team.runsAgainst}</td>
          <td class="col-diff">${diffFormatted}</td>
          <td class="col-margin">${marginBadge}</td>
          <td class="col-rem stat-num">${team.remainingGames}</td>
          <td class="col-streak">
            <span class="streak-badge ${streakClass}">
              <i class="ph ${streakIcon}"></i> ${streakText}
            </span>
          </td>
          <td class="col-actions">
            <div class="action-btn-group">
              <button class="action-icon-btn" onclick="app.openTeamStatsModal('${team.id}')" title="成績を直接編集">
                <i class="ph ph-pencil-simple"></i>
              </button>
              <button class="action-icon-btn" onclick="app.openTeamModal('${team.id}')" title="チーム情報編集">
                <i class="ph ph-gear"></i>
              </button>
              <button class="action-icon-btn delete-btn" onclick="app.deleteTeam('${team.id}')" title="チーム削除">
                <i class="ph ph-trash"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
  }

  renderMatrix() {
    const thead = document.getElementById('matrixTableHead');
    const tbody = document.getElementById('matrixTableBody');
    if (!thead || !tbody) return;

    if (this.teams.length === 0) {
      thead.innerHTML = '';
      tbody.innerHTML = '<tr><td style="padding: 2rem; color: var(--text-muted);">チームがありません</td></tr>';
      return;
    }

    const sortedTeams = this.getSortedStandings();

    let headHtml = '<tr><th style="width: 140px;">チーム \\ 相手</th>';
    sortedTeams.forEach(t => {
      headHtml += `
        <th class="matrix-team-th">
          <div class="matrix-header-cell">
            <div class="team-badge-circle" style="background-color: ${t.color || '#3b82f6'}; width:24px; height:24px; font-size:0.75rem;">
              ${t.icon || t.shortName.charAt(0)}
            </div>
            <span>${this.escapeHTML(t.shortName)}</span>
          </div>
        </th>
      `;
    });
    headHtml += '</tr>';
    thead.innerHTML = headHtml;

    let bodyHtml = '';
    sortedTeams.forEach(teamRow => {
      bodyHtml += `<tr>`;
      bodyHtml += `
        <th style="text-align: left; padding: 0.6rem 0.8rem;">
          <div class="team-cell-content">
            <div class="team-badge-circle" style="background-color: ${teamRow.color || '#3b82f6'}; width:26px; height:26px; font-size:0.8rem;">
              ${teamRow.icon || teamRow.shortName.charAt(0)}
            </div>
            <span style="font-weight: 700; color: var(--text-primary); font-size: 0.88rem;">${this.escapeHTML(teamRow.shortName)}</span>
          </div>
        </th>
      `;

      sortedTeams.forEach(teamCol => {
        if (teamRow.id === teamCol.id) {
          bodyHtml += `<td class="matrix-cell-diagonal">-</td>`;
        } else {
          const rec = this.getMatchRecord(teamRow.id, teamCol.id);
          const remaining = Math.max(0, this.settings.gamesPerMatch - rec.totalGames);

          let advantageBadge = '';
          if (rec.wins > rec.losses) {
            advantageBadge = `<span class="match-advantage adv-win">勝越</span>`;
          } else if (rec.wins < rec.losses) {
            advantageBadge = `<span class="match-advantage adv-lose">負越</span>`;
          } else if (rec.totalGames > 0) {
            advantageBadge = `<span class="match-advantage adv-even">五分</span>`;
          }

          bodyHtml += `
            <td class="matrix-match-cell" onclick="app.openCardGamesModal('${teamRow.id}', '${teamCol.id}')" title="${teamRow.shortName} vs ${teamCol.shortName} の詳細試合一覧 (クリック)">
              <div class="matrix-record-box">
                <div class="matrix-record-score">
                  <span class="rec-w">${rec.wins}</span>-<span class="rec-l">${rec.losses}</span><span class="rec-d">-${rec.draws}</span>
                </div>
                <div class="matrix-record-sub">
                  ${advantageBadge}
                  <span class="rem-count">残${remaining}</span>
                </div>
              </div>
            </td>
          `;
        }
      });
      bodyHtml += `</tr>`;
    });

    tbody.innerHTML = bodyHtml;
  }

  renderSummaryStats() {
    const standings = this.getSortedStandings();
    if (standings.length === 0) return;

    const topRuns = [...standings].sort((a, b) => b.runs - a.runs)[0];
    const topRunsTeam = document.getElementById('topRunsTeam');
    const topRunsVal = document.getElementById('topRunsVal');
    if (topRunsTeam && topRuns) topRunsTeam.textContent = topRuns.name;
    if (topRunsVal && topRuns) topRunsVal.textContent = `${topRuns.runs} 得点`;

    const topDefense = [...standings].sort((a, b) => a.runsAgainst - b.runsAgainst)[0];
    const topDefenseTeam = document.getElementById('topDefenseTeam');
    const topDefenseVal = document.getElementById('topDefenseVal');
    if (topDefenseTeam && topDefense) topDefenseTeam.textContent = topDefense.name;
    if (topDefenseVal && topDefense) topDefenseVal.textContent = `${topDefense.runsAgainst} 失点`;

    const topDiff = [...standings].sort((a, b) => b.diff - a.diff)[0];
    const topDiffTeam = document.getElementById('topDiffTeam');
    const topDiffVal = document.getElementById('topDiffVal');
    if (topDiffTeam && topDiff) topDiffTeam.textContent = topDiff.name;
    if (topDiffVal && topDiff) topDiffVal.textContent = topDiff.diff > 0 ? `+${topDiff.diff}` : `${topDiff.diff}`;

    let totalPlayed = 0;
    for (let i = 0; i < this.teams.length; i++) {
      for (let j = i + 1; j < this.teams.length; j++) {
        const rec = this.getMatchRecord(this.teams[i].id, this.teams[j].id);
        totalPlayed += rec.totalGames;
      }
    }

    const totalPossibleMatches = (this.teams.length * (this.teams.length - 1) / 2) * this.settings.gamesPerMatch;
    const totalGamesPlayedEl = document.getElementById('totalGamesPlayed');
    const leagueProgressPctEl = document.getElementById('leagueProgressPct');

    if (totalGamesPlayedEl) totalGamesPlayedEl.textContent = `${totalPlayed} / ${totalPossibleMatches} 試合`;
    if (leagueProgressPctEl) {
      const progress = totalPossibleMatches > 0 ? ((totalPlayed / totalPossibleMatches) * 100).toFixed(1) : 0;
      leagueProgressPctEl.textContent = `進捗率: ${progress}%`;
    }
  }

  // ==========================================
  // 1試合ごとの試合結果一覧
  // ==========================================
  renderFilterOptions() {
    const filterTeamSelect = document.getElementById('filterTeamSelect');
    const filterVsSelect = document.getElementById('filterVsSelect');
    const playerTeamSelect = document.getElementById('playerTeamSelect');

    if (filterTeamSelect) {
      const cur = filterTeamSelect.value;
      let opts = '<option value="all">全チーム表示</option>';
      this.teams.forEach(t => { opts += `<option value="${t.id}">${this.escapeHTML(t.name)} (${t.shortName})</option>`; });
      filterTeamSelect.innerHTML = opts;
      if (cur) filterTeamSelect.value = cur;
    }

    if (filterVsSelect) {
      const cur = filterVsSelect.value;
      let opts = '<option value="all">すべての対戦カード</option>';
      for (let i = 0; i < this.teams.length; i++) {
        for (let j = i + 1; j < this.teams.length; j++) {
          const key = this.getMatchKey(this.teams[i].id, this.teams[j].id);
          opts += `<option value="${key}">${this.teams[i].shortName} vs ${this.teams[j].shortName}</option>`;
        }
      }
      filterVsSelect.innerHTML = opts;
      if (cur) filterVsSelect.value = cur;
    }

    if (playerTeamSelect) {
      const cur = playerTeamSelect.value;
      let opts = '<option value="all">全チーム</option>';
      this.teams.forEach(t => { opts += `<option value="${t.id}">${this.escapeHTML(t.name)}</option>`; });
      playerTeamSelect.innerHTML = opts;
      if (cur) playerTeamSelect.value = cur;
    }
  }

  renderGamesList() {
    const container = document.getElementById('gamesGridContainer');
    if (!container) return;

    const filterTeam = document.getElementById('filterTeamSelect') ? document.getElementById('filterTeamSelect').value : 'all';
    const filterVs = document.getElementById('filterVsSelect') ? document.getElementById('filterVsSelect').value : 'all';
    const sortOrder = document.getElementById('sortOrderSelect') ? document.getElementById('sortOrderSelect').value : 'newest';

    let filtered = [...this.games];

    if (filterTeam !== 'all') {
      filtered = filtered.filter(g => g.awayTeamId === filterTeam || g.homeTeamId === filterTeam);
    }
    if (filterVs !== 'all') {
      filtered = filtered.filter(g => this.getMatchKey(g.awayTeamId, g.homeTeamId) === filterVs);
    }

    if (sortOrder === 'newest') {
      filtered.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.round - a.round);
    } else if (sortOrder === 'oldest') {
      filtered.sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.round - b.round);
    } else if (sortOrder === 'round') {
      filtered.sort((a, b) => a.round - b.round);
    }

    if (filtered.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 4rem; text-align: center; color: var(--text-muted);">
          <i class="ph-bold ph-baseball" style="font-size: 2.5rem; display: block; margin-bottom: 0.75rem; color: var(--accent-primary);"></i>
          <h4 style="font-size: 1.1rem; color: var(--text-primary); margin-bottom: 0.4rem;">登録された試合記録がありません</h4>
          <p style="font-size: 0.85rem; margin-bottom: 1rem;">「全試合を一括自動作成」または「新規試合結果を記録」から試合を作成できます。</p>
          <button class="btn btn-primary" onclick="app.openSingleGameModal()">
            <i class="ph ph-plus-circle"></i> 試合結果を入力する
          </button>
        </div>
      `;
      return;
    }

    let html = '';
    filtered.forEach(game => {
      const awayTeam = this.teams.find(t => t.id === game.awayTeamId) || { name: '先攻', shortName: '先攻', color: '#64748b' };
      const homeTeam = this.teams.find(t => t.id === game.homeTeamId) || { name: '後攻', shortName: '後攻', color: '#64748b' };

      const isAwayWin = game.awayScore > game.homeScore;
      const isHomeWin = game.homeScore > game.awayScore;

      html += `
        <div class="game-card">
          <div class="game-card-header">
            <span class="game-round-tag">
              <i class="ph-fill ph-baseball"></i> 第${game.round}回戦
            </span>
            <span class="game-meta-tag">
              ${game.date ? `<i class="ph ph-calendar"></i> ${game.date}` : ''}
              ${game.stadium ? ` @ ${this.escapeHTML(game.stadium)}` : ''}
            </span>
          </div>

          <div class="game-card-body">
            <div class="game-scoreboard">
              <div class="game-team-side">
                <div class="team-badge-circle" style="background-color: ${awayTeam.color || '#3b82f6'}; width: 36px; height: 36px; font-size: 0.95rem;">
                  ${awayTeam.icon || awayTeam.shortName.charAt(0)}
                </div>
                <span class="game-team-name">${this.escapeHTML(awayTeam.shortName)}</span>
                <span class="game-team-role">先攻 (ビジター)</span>
              </div>

              <div class="game-score-display">
                <span class="score-digit ${isAwayWin ? 'winner' : ''}">${game.awayScore}</span>
                <span class="score-vs-hyphen">-</span>
                <span class="score-digit ${isHomeWin ? 'winner' : ''}">${game.homeScore}</span>
              </div>

              <div class="game-team-side">
                <div class="team-badge-circle" style="background-color: ${homeTeam.color || '#10b981'}; width: 36px; height: 36px; font-size: 0.95rem;">
                  ${homeTeam.icon || homeTeam.shortName.charAt(0)}
                </div>
                <span class="game-team-name">${this.escapeHTML(homeTeam.shortName)}</span>
                <span class="game-team-role">後攻 (ホーム)</span>
              </div>
            </div>

            <div class="game-details-box">
              ${(game.awayStarter || game.homeStarter) ? `
                <div class="detail-row">
                  <span class="detail-label"><span class="badge-p badge-starter">先</span> 先発:</span>
                  <span class="detail-content">
                    [${awayTeam.shortName}] ${this.escapeHTML(game.awayStarter || '-')} vs [${homeTeam.shortName}] ${this.escapeHTML(game.homeStarter || '-')}
                  </span>
                </div>
              ` : ''}

              ${game.winPitcher ? `
                <div class="detail-row">
                  <span class="detail-label"><span class="badge-p badge-win">勝</span> 勝利投手:</span>
                  <span class="detail-content">${this.escapeHTML(game.winPitcher)}</span>
                </div>
              ` : ''}

              ${game.losePitcher ? `
                <div class="detail-row">
                  <span class="detail-label"><span class="badge-p badge-lose">敗</span> 敗戦投手:</span>
                  <span class="detail-content">${this.escapeHTML(game.losePitcher)}</span>
                </div>
              ` : ''}

              ${game.savePitcher ? `
                <div class="detail-row">
                  <span class="detail-label"><span class="badge-p badge-save">Ｓ</span> セーブ:</span>
                  <span class="detail-content">${this.escapeHTML(game.savePitcher)}</span>
                </div>
              ` : ''}

              ${game.homeRuns ? `
                <div class="detail-row">
                  <span class="detail-label"><span class="badge-p badge-hr">本</span> 本塁打:</span>
                  <span class="detail-content" style="color: #fb923c; font-weight: 600;">${this.escapeHTML(game.homeRuns)}</span>
                </div>
              ` : ''}

              ${game.notes ? `
                <div class="game-notes"><i class="ph ph-chat-circle-text"></i> ${this.escapeHTML(game.notes)}</div>
              ` : ''}
            </div>
          </div>

          <div class="game-card-footer">
            <button class="btn btn-sm btn-outline" onclick="app.openSingleGameModal('${game.id}')" title="編集">
              <i class="ph ph-pencil-simple"></i> 編集
            </button>
            <button class="btn btn-sm btn-outline" style="color: var(--color-lose);" onclick="app.deleteGame('${game.id}')" title="削除">
              <i class="ph ph-trash"></i> 削除
            </button>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  }

  // ==========================================
  // 選手名鑑 & 個人成績セクションの描画
  // ==========================================
  renderPlayersSection() {
    this.renderFilterOptions();
    if (this.currentPlayerSubtab === 'batting') {
      this.renderBattingTable();
    } else if (this.currentPlayerSubtab === 'pitching') {
      this.renderPitchingTable();
    } else if (this.currentPlayerSubtab === 'leaders') {
      this.renderLeadersBoard();
    }
  }

  renderBattingTable() {
    const tbody = document.getElementById('battingStatsTableBody');
    if (!tbody) return;

    let list = this.players.filter(p => p.type === 'batting' || (p.position && p.position !== '投手'));
    if (this.selectedPlayerTeam !== 'all') {
      list = list.filter(p => p.teamId === this.selectedPlayerTeam);
    }

    if (list.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="26" style="padding: 3rem; color: var(--text-muted);">
            登録された野手・打撃成績データがありません。「新規選手を登録」ボタンから選手を追加できます。
          </td>
        </tr>
      `;
      return;
    }

    // 打率順にソート
    const calculatedList = list.map(p => {
      const stats = this.calcBattingStats(p.batting || {});
      return { ...p, stats };
    });
    calculatedList.sort((a, b) => b.stats.avg - a.stats.avg || b.stats.hr - a.stats.hr);

    let html = '';
    calculatedList.forEach(p => {
      const team = this.teams.find(t => t.id === p.teamId) || { shortName: '-', color: '#64748b' };
      const s = p.stats;
      const isSelected = this.selectedPlayerIds.has(p.id);

      let posBadgeClass = 'pos-if';
      if (p.position === '投手') posBadgeClass = 'pos-p';
      else if (p.position === '捕手') posBadgeClass = 'pos-c';
      else if (['外野手', '右翼手', '中堅手', '左翼手'].includes(p.position)) posBadgeClass = 'pos-of';
      else if (p.position === '指名打者') posBadgeClass = 'pos-dh';

      html += `
        <tr class="${isSelected ? 'selected-row' : ''}">
          <td class="col-p-chk">
            <input type="checkbox" class="player-checkbox" value="${p.id}" ${isSelected ? 'checked' : ''} onchange="app.toggleSelectPlayer('${p.id}', this.checked)">
          </td>
          <td class="col-p-num">#${p.number || '-'}</td>
          <td class="col-p-team">
            <span style="color: ${team.color || '#3b82f6'}; font-weight:700;">${this.escapeHTML(team.shortName)}</span>
          </td>
          <td class="col-p-name">${this.escapeHTML(p.name)}</td>
          <td class="col-p-pos"><span class="pos-badge ${posBadgeClass}">${p.position || '-'}</span></td>
          <td class="col-p-bat">${p.throwsBats || '-'}</td>
          <td class="col-p-highlight stat-num">${s.avgStr}</td>
          <td class="stat-num">${s.g || 0}</td>
          <td class="stat-num">${s.pa || 0}</td>
          <td class="stat-num">${s.ab || 0}</td>
          <td class="stat-num">${s.r || 0}</td>
          <td class="stat-num">${s.h || 0}</td>
          <td class="stat-num">${s.b2 || 0}</td>
          <td class="stat-num">${s.b3 || 0}</td>
          <td class="col-p-highlight stat-num">${s.hr || 0}</td>
          <td class="col-p-highlight stat-num">${s.rbi || 0}</td>
          <td class="stat-num">${s.sb || 0}</td>
          <td class="stat-num">${s.cs || 0}</td>
          <td class="stat-num">${s.bb || 0}</td>
          <td class="stat-num">${s.hbp || 0}</td>
          <td class="stat-num">${s.so || 0}</td>
          <td class="stat-num">${s.sh || 0}</td>
          <td class="stat-num">${s.sf || 0}</td>
          <td class="stat-num">${s.obpStr}</td>
          <td class="stat-num">${s.slgStr}</td>
          <td class="col-p-highlight stat-num">${s.opsStr}</td>
          <td class="col-actions">
            <div class="action-btn-group">
              <button class="action-icon-btn" onclick="app.openPlayerModal('${p.id}')" title="成績を編集">
                <i class="ph ph-pencil-simple"></i>
              </button>
              <button class="action-icon-btn delete-btn" onclick="app.deletePlayer('${p.id}')" title="選手削除">
                <i class="ph ph-trash"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
    this.updateCheckAllState();
    this.updateDeleteSelectedBtn();
  }

  renderPitchingTable() {
    const tbody = document.getElementById('pitchingStatsTableBody');
    if (!tbody) return;

    let list = this.players.filter(p => p.type === 'pitching' || p.position === '投手');
    if (this.selectedPlayerTeam !== 'all') {
      list = list.filter(p => p.teamId === this.selectedPlayerTeam);
    }

    if (list.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="26" style="padding: 3rem; color: var(--text-muted);">
            登録された投手成績データがありません。「新規選手を登録」ボタンから投手を追加できます。
          </td>
        </tr>
      `;
      return;
    }

    const calculatedList = list.map(p => {
      const stats = this.calcPitchingStats(p.pitching || {});
      return { ...p, stats };
    });
    calculatedList.sort((a, b) => a.stats.era - b.stats.era || b.stats.w - a.stats.w);

    let html = '';
    calculatedList.forEach(p => {
      const team = this.teams.find(t => t.id === p.teamId) || { shortName: '-', color: '#64748b' };
      const s = p.stats;
      const isSelected = this.selectedPlayerIds.has(p.id);

      html += `
        <tr class="${isSelected ? 'selected-row' : ''}">
          <td class="col-p-chk">
            <input type="checkbox" class="player-checkbox" value="${p.id}" ${isSelected ? 'checked' : ''} onchange="app.toggleSelectPlayer('${p.id}', this.checked)">
          </td>
          <td class="col-p-num">#${p.number || '-'}</td>
          <td class="col-p-team">
            <span style="color: ${team.color || '#3b82f6'}; font-weight:700;">${this.escapeHTML(team.shortName)}</span>
          </td>
          <td class="col-p-name">${this.escapeHTML(p.name)}</td>
          <td class="col-p-bat">${p.throwsBats || '-'}</td>
          <td class="col-p-highlight stat-num">${s.eraStr}</td>
          <td class="stat-num">${s.g || 0}</td>
          <td class="stat-num">${s.gs || 0}</td>
          <td class="stat-num">${s.cg || 0}</td>
          <td class="stat-num">${s.sho || 0}</td>
          <td class="col-p-highlight stat-num">${s.w || 0}</td>
          <td class="stat-num">${s.l || 0}</td>
          <td class="col-p-highlight stat-num">${s.sv || 0}</td>
          <td class="stat-num">${s.hld || 0}</td>
          <td class="stat-num">${s.wpctStr}</td>
          <td class="stat-num">${s.ip || 0}</td>
          <td class="stat-num">${s.h || 0}</td>
          <td class="stat-num">${s.hr || 0}</td>
          <td class="stat-num">${s.bb || 0}</td>
          <td class="stat-num">${s.hbp || 0}</td>
          <td class="col-p-highlight stat-num">${s.so || 0}</td>
          <td class="stat-num">${s.r || 0}</td>
          <td class="stat-num">${s.er || 0}</td>
          <td class="stat-num">${s.whipStr}</td>
          <td class="stat-num">${s.k9Str}</td>
          <td class="stat-num">${s.kbbStr}</td>
          <td class="col-actions">
            <div class="action-btn-group">
              <button class="action-icon-btn" onclick="app.openPlayerModal('${p.id}')" title="成績を編集">
                <i class="ph ph-pencil-simple"></i>
              </button>
              <button class="action-icon-btn delete-btn" onclick="app.deletePlayer('${p.id}')" title="選手削除">
                <i class="ph ph-trash"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
    this.updateCheckAllState();
    this.updateDeleteSelectedBtn();
  }

  renderLeadersBoard() {
    const container = document.getElementById('leadersContainer');
    if (!container) return;

    const battingPlayers = this.players.filter(p => p.type === 'batting' || (p.position && p.position !== '投手')).map(p => ({
      ...p,
      stats: this.calcBattingStats(p.batting || {})
    }));

    const pitchingPlayers = this.players.filter(p => p.type === 'pitching' || p.position === '投手').map(p => ({
      ...p,
      stats: this.calcPitchingStats(p.pitching || {})
    }));

    // ランキングヘルパー
    const getTop = (list, key, isAsc = false) => {
      const sorted = [...list].sort((a, b) => isAsc ? (a.stats[key] - b.stats[key]) : (b.stats[key] - a.stats[key]));
      return sorted.slice(0, 5);
    };

    const renderCard = (title, unit, list, key, formatFn) => {
      const topList = getTop(list, key, key === 'era' || key === 'whip');
      let rowsHtml = '';
      topList.forEach((p, idx) => {
        const team = this.teams.find(t => t.id === p.teamId) || { shortName: '-' };
        const badgeClass = idx === 0 ? 'rank-1-mini' : (idx === 1 ? 'rank-2-mini' : (idx === 2 ? 'rank-3-mini' : 'rank-other-mini'));
        rowsHtml += `
          <div class="leader-row">
            <span class="leader-rank-badge ${badgeClass}">${idx + 1}</span>
            <div class="leader-player-info">
              <span class="leader-player-name">${this.escapeHTML(p.name)}</span>
              <span class="leader-player-team">(${team.shortName})</span>
            </div>
            <span class="leader-val">${formatFn ? formatFn(p.stats[key]) : p.stats[key]}</span>
          </div>
        `;
      });

      if (topList.length === 0) {
        rowsHtml = '<div style="padding: 1rem; color: var(--text-muted); text-align:center;">データなし</div>';
      }

      return `
        <div class="leader-card">
          <div class="leader-card-header">
            <span class="leader-title"><i class="ph-fill ph-trophy"></i> ${title}</span>
            <span class="leader-unit">${unit}</span>
          </div>
          <div class="leader-card-body">
            ${rowsHtml}
          </div>
        </div>
      `;
    };

    let html = `
      <div>
        <div class="leaders-category-title"><i class="ph-bold ph-baseball-bat"></i> 打撃部門 リーダー</div>
        <div class="leaders-grid">
          ${renderCard('首位打者 (打率)', 'AVG', battingPlayers, 'avg', v => v >= 1.0 ? '1.000' : (v === 0 ? '.000' : v.toFixed(3).substring(1)))}
          ${renderCard('本塁打王 (ホームラン)', '本', battingPlayers, 'hr')}
          ${renderCard('打点王 (打点)', '点', battingPlayers, 'rbi')}
          ${renderCard('最高出塁率', 'OBP', battingPlayers, 'obp', v => v >= 1.0 ? '1.000' : (v === 0 ? '.000' : v.toFixed(3).substring(1)))}
          ${renderCard('OPS リーダー', 'OPS', battingPlayers, 'ops', v => v.toFixed(3))}
          ${renderCard('盗塁王', '盗塁', battingPlayers, 'sb')}
        </div>
      </div>

      <div style="margin-top: 1.5rem;">
        <div class="leaders-category-title"><i class="ph-bold ph-target"></i> 投手部門 リーダー</div>
        <div class="leaders-grid">
          ${renderCard('最優秀防御率', 'ERA', pitchingPlayers, 'era', v => v.toFixed(2))}
          ${renderCard('最多勝利 (最多勝)', '勝', pitchingPlayers, 'w')}
          ${renderCard('最多奪三振', '奪三振', pitchingPlayers, 'so')}
          ${renderCard('最多セーブ (セーブ王)', 'S', pitchingPlayers, 'sv')}
          ${renderCard('最高勝率', 'WPCT', pitchingPlayers, 'wpct', v => v >= 1.0 ? '1.000' : (v === 0 ? '.000' : v.toFixed(3).substring(1)))}
          ${renderCard('最優秀WHIP', 'WHIP', pitchingPlayers, 'whip', v => v.toFixed(2))}
        </div>
      </div>
    `;

    container.innerHTML = html;
  }

  // ==========================================
  // モーダル: 選手登録 & 成績編集
  // ==========================================
  openPlayerModal(playerId = null) {
    if (this.teams.length === 0) {
      alert('選手を登録するには、まずチームを作成してください。');
      return;
    }

    const titleEl = document.getElementById('playerModalTitle');
    const editIdEl = document.getElementById('editPlayerId');
    const teamSelect = document.getElementById('playerTeamInput');
    const numberInput = document.getElementById('playerNumberInput');
    const nameInput = document.getElementById('playerNameInput');
    const posSelect = document.getElementById('playerPositionInput');
    const tbSelect = document.getElementById('playerThrowsBatsInput');

    let teamOpts = '';
    this.teams.forEach(t => {
      teamOpts += `<option value="${t.id}">${this.escapeHTML(t.name)}</option>`;
    });
    teamSelect.innerHTML = teamOpts;

    if (playerId) {
      const p = this.players.find(x => x.id === playerId);
      if (!p) return;
      titleEl.innerHTML = `<i class="ph ph-user-circle"></i> 選手情報 & 成績の編集`;
      editIdEl.value = p.id;
      teamSelect.value = p.teamId;
      numberInput.value = p.number;
      nameInput.value = p.name;
      posSelect.value = p.position || '内野手';
      tbSelect.value = p.throwsBats || '右投右打';

      const isPitcher = p.type === 'pitching' || p.position === '投手';
      this.togglePlayerStatForm(isPitcher ? 'pitching' : 'batting');

      // 打撃値
      const b = p.batting || {};
      document.getElementById('statG').value = b.g || 0;
      document.getElementById('statPA').value = b.pa || 0;
      document.getElementById('statAB').value = b.ab || 0;
      document.getElementById('statR').value = b.r || 0;
      document.getElementById('statH').value = b.h || 0;
      document.getElementById('stat2B').value = b.b2 || 0;
      document.getElementById('stat3B').value = b.b3 || 0;
      document.getElementById('statHR').value = b.hr || 0;
      document.getElementById('statRBI').value = b.rbi || 0;
      document.getElementById('statSB').value = b.sb || 0;
      document.getElementById('statCS').value = b.cs || 0;
      document.getElementById('statBB').value = b.bb || 0;
      document.getElementById('statHBP').value = b.hbp || 0;
      document.getElementById('statSO').value = b.so || 0;
      document.getElementById('statSH').value = b.sh || 0;
      document.getElementById('statSF').value = b.sf || 0;

      // 投手値
      const pt = p.pitching || {};
      document.getElementById('pstatG').value = pt.g || 0;
      document.getElementById('pstatGS').value = pt.gs || 0;
      document.getElementById('pstatCG').value = pt.cg || 0;
      document.getElementById('pstatSHO').value = pt.sho || 0;
      document.getElementById('pstatW').value = pt.w || 0;
      document.getElementById('pstatL').value = pt.l || 0;
      document.getElementById('pstatSV').value = pt.sv || 0;
      document.getElementById('pstatHLD').value = pt.hld || 0;
      document.getElementById('pstatIP').value = pt.ip || 0;
      document.getElementById('pstatH').value = pt.h || 0;
      document.getElementById('pstatHR').value = pt.hr || 0;
      document.getElementById('pstatBB').value = pt.bb || 0;
      document.getElementById('pstatHBP').value = pt.hbp || 0;
      document.getElementById('pstatSO').value = pt.so || 0;
      document.getElementById('pstatR').value = pt.r || 0;
      document.getElementById('pstatER').value = pt.er || 0;

      this.updateLiveBattingCalc();
      this.updateLivePitchingCalc();
    } else {
      titleEl.innerHTML = `<i class="ph ph-user-plus"></i> 新規選手の登録`;
      editIdEl.value = '';
      numberInput.value = '';
      nameInput.value = '';
      posSelect.value = '内野手';
      tbSelect.value = '右投右打';
      this.togglePlayerStatForm('batting');

      // リセット
      ['statG', 'statPA', 'statAB', 'statR', 'statH', 'stat2B', 'stat3B', 'statHR', 'statRBI', 'statSB', 'statCS', 'statBB', 'statHBP', 'statSO', 'statSH', 'statSF',
       'pstatG', 'pstatGS', 'pstatCG', 'pstatSHO', 'pstatW', 'pstatL', 'pstatSV', 'pstatHLD', 'pstatIP', 'pstatH', 'pstatHR', 'pstatBB', 'pstatHBP', 'pstatSO', 'pstatR', 'pstatER'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = 0;
      });

      this.updateLiveBattingCalc();
      this.updateLivePitchingCalc();
    }

    this.openModal('playerModal');
  }

  handlePositionChange(pos) {
    if (pos === '投手') {
      this.togglePlayerStatForm('pitching');
    } else {
      this.togglePlayerStatForm('batting');
    }
  }

  togglePlayerStatForm(type) {
    const boxB = document.getElementById('playerBattingFormBox');
    const boxP = document.getElementById('playerPitchingFormBox');
    const radioB = document.getElementById('radioTypeBatting');
    const radioP = document.getElementById('radioTypePitching');

    if (type === 'pitching') {
      if (boxB) boxB.style.display = 'none';
      if (boxP) boxP.style.display = 'flex';
      if (radioP) radioP.checked = true;
      this.updateLivePitchingCalc();
    } else {
      if (boxB) boxB.style.display = 'flex';
      if (boxP) boxP.style.display = 'none';
      if (radioB) radioB.checked = true;
      this.updateLiveBattingCalc();
    }
  }

  updateLiveBattingCalc() {
    const ab = parseInt(document.getElementById('statAB').value, 10) || 0;
    const h = parseInt(document.getElementById('statH').value, 10) || 0;
    const b2 = parseInt(document.getElementById('stat2B').value, 10) || 0;
    const b3 = parseInt(document.getElementById('stat3B').value, 10) || 0;
    const hr = parseInt(document.getElementById('statHR').value, 10) || 0;
    const bb = parseInt(document.getElementById('statBB').value, 10) || 0;
    const hbp = parseInt(document.getElementById('statHBP').value, 10) || 0;
    const sf = parseInt(document.getElementById('statSF').value, 10) || 0;

    const stats = this.calcBattingStats({ ab, h, b2, b3, hr, bb, hbp, sf });

    const pAVG = document.getElementById('previewAVG');
    const pOBP = document.getElementById('previewOBP');
    const pSLG = document.getElementById('previewSLG');
    const pOPS = document.getElementById('previewOPS');

    if (pAVG) pAVG.textContent = stats.avgStr;
    if (pOBP) pOBP.textContent = stats.obpStr;
    if (pSLG) pSLG.textContent = stats.slgStr;
    if (pOPS) pOPS.textContent = stats.opsStr;
  }

  updateLivePitchingCalc() {
    const ip = parseFloat(document.getElementById('pstatIP').value) || 0;
    const er = parseInt(document.getElementById('pstatER').value, 10) || 0;
    const w = parseInt(document.getElementById('pstatW').value, 10) || 0;
    const l = parseInt(document.getElementById('pstatL').value, 10) || 0;
    const h = parseInt(document.getElementById('pstatH').value, 10) || 0;
    const bb = parseInt(document.getElementById('pstatBB').value, 10) || 0;
    const so = parseInt(document.getElementById('pstatSO').value, 10) || 0;

    const stats = this.calcPitchingStats({ ip, er, w, l, h, bb, so });

    const pERA = document.getElementById('previewERA');
    const pWPCT = document.getElementById('previewWPCT');
    const pWHIP = document.getElementById('previewWHIP');
    const pK9 = document.getElementById('previewK9');

    if (pERA) pERA.textContent = stats.eraStr;
    if (pWPCT) pWPCT.textContent = stats.wpctStr;
    if (pWHIP) pWHIP.textContent = stats.whipStr;
    if (pK9) pK9.textContent = stats.k9Str;
  }

  handleSavePlayer(event) {
    event.preventDefault();
    const id = document.getElementById('editPlayerId').value;
    const teamId = document.getElementById('playerTeamInput').value;
    const number = parseInt(document.getElementById('playerNumberInput').value, 10) || 0;
    const name = document.getElementById('playerNameInput').value.trim();
    const position = document.getElementById('playerPositionInput').value;
    const throwsBats = document.getElementById('playerThrowsBatsInput').value;
    const type = document.querySelector('input[name="statTypeRadio"]:checked').value;

    if (!name) {
      alert('選手名は必須です。');
      return;
    }

    const batting = {
      g: parseInt(document.getElementById('statG').value, 10) || 0,
      pa: parseInt(document.getElementById('statPA').value, 10) || 0,
      ab: parseInt(document.getElementById('statAB').value, 10) || 0,
      r: parseInt(document.getElementById('statR').value, 10) || 0,
      h: parseInt(document.getElementById('statH').value, 10) || 0,
      b2: parseInt(document.getElementById('stat2B').value, 10) || 0,
      b3: parseInt(document.getElementById('stat3B').value, 10) || 0,
      hr: parseInt(document.getElementById('statHR').value, 10) || 0,
      rbi: parseInt(document.getElementById('statRBI').value, 10) || 0,
      sb: parseInt(document.getElementById('statSB').value, 10) || 0,
      cs: parseInt(document.getElementById('statCS').value, 10) || 0,
      bb: parseInt(document.getElementById('statBB').value, 10) || 0,
      hbp: parseInt(document.getElementById('statHBP').value, 10) || 0,
      so: parseInt(document.getElementById('statSO').value, 10) || 0,
      sh: parseInt(document.getElementById('statSH').value, 10) || 0,
      sf: parseInt(document.getElementById('statSF').value, 10) || 0
    };

    const pitching = {
      g: parseInt(document.getElementById('pstatG').value, 10) || 0,
      gs: parseInt(document.getElementById('pstatGS').value, 10) || 0,
      cg: parseInt(document.getElementById('pstatCG').value, 10) || 0,
      sho: parseInt(document.getElementById('pstatSHO').value, 10) || 0,
      w: parseInt(document.getElementById('pstatW').value, 10) || 0,
      l: parseInt(document.getElementById('pstatL').value, 10) || 0,
      sv: parseInt(document.getElementById('pstatSV').value, 10) || 0,
      hld: parseInt(document.getElementById('pstatHLD').value, 10) || 0,
      ip: parseFloat(document.getElementById('pstatIP').value) || 0,
      h: parseInt(document.getElementById('pstatH').value, 10) || 0,
      hr: parseInt(document.getElementById('pstatHR').value, 10) || 0,
      bb: parseInt(document.getElementById('pstatBB').value, 10) || 0,
      hbp: parseInt(document.getElementById('pstatHBP').value, 10) || 0,
      so: parseInt(document.getElementById('pstatSO').value, 10) || 0,
      r: parseInt(document.getElementById('pstatR').value, 10) || 0,
      er: parseInt(document.getElementById('pstatER').value, 10) || 0
    };

    const playerData = {
      id: id || ('p_' + Date.now()),
      teamId,
      number,
      name,
      position,
      throwsBats,
      type,
      batting,
      pitching
    };

    if (id) {
      const idx = this.players.findIndex(x => x.id === id);
      if (idx !== -1) this.players[idx] = playerData;
    } else {
      this.players.push(playerData);
    }

    this.saveToStorage();
    this.closeModal('playerModal');
    this.render();
  }

  deletePlayer(playerId) {
    if (!confirm('この選手情報を削除しますか？')) return;
    this.players = this.players.filter(x => x.id !== playerId);
    this.selectedPlayerIds.delete(playerId);
    this.saveToStorage();
    this.updateDeleteSelectedBtn();
    this.render();
  }

  // ==========================================
  // 選手の一括削除 & 選択削除 (まとめて削除)
  // ==========================================
  // 個別チェックボックスのトグル
  toggleSelectPlayer(playerId, isChecked) {
    if (isChecked) {
      this.selectedPlayerIds.add(playerId);
    } else {
      this.selectedPlayerIds.delete(playerId);
    }
    this.updateDeleteSelectedBtn();
    this.updateCheckAllState();
  }

  // 全選択 / 全解除
  toggleSelectAllPlayers(tableType, isChecked) {
    let currentList = [];
    if (tableType === 'batting') {
      currentList = this.players.filter(p => p.type === 'batting' || (p.position && p.position !== '投手'));
    } else if (tableType === 'pitching') {
      currentList = this.players.filter(p => p.type === 'pitching' || p.position === '投手');
    }
    if (this.selectedPlayerTeam !== 'all') {
      currentList = currentList.filter(p => p.teamId === this.selectedPlayerTeam);
    }

    currentList.forEach(p => {
      if (isChecked) {
        this.selectedPlayerIds.add(p.id);
      } else {
        this.selectedPlayerIds.delete(p.id);
      }
    });

    this.updateDeleteSelectedBtn();
    if (tableType === 'batting') this.renderBattingTable();
    else if (tableType === 'pitching') this.renderPitchingTable();
  }

  // 全選択チェックボックスの同期
  updateCheckAllState() {
    const chkBatting = document.getElementById('checkAllBatting');
    const chkPitching = document.getElementById('checkAllPitching');

    let battingList = this.players.filter(p => p.type === 'batting' || (p.position && p.position !== '投手'));
    let pitchingList = this.players.filter(p => p.type === 'pitching' || p.position === '投手');
    if (this.selectedPlayerTeam !== 'all') {
      battingList = battingList.filter(p => p.teamId === this.selectedPlayerTeam);
      pitchingList = pitchingList.filter(p => p.teamId === this.selectedPlayerTeam);
    }

    if (chkBatting) {
      chkBatting.checked = battingList.length > 0 && battingList.every(p => this.selectedPlayerIds.has(p.id));
    }
    if (chkPitching) {
      chkPitching.checked = pitchingList.length > 0 && pitchingList.every(p => this.selectedPlayerIds.has(p.id));
    }
  }

  // 「選択した選手を削除 (X名)」ボタンの表示更新
  updateDeleteSelectedBtn() {
    const btn = document.getElementById('deleteSelectedPlayersBtn');
    const textEl = document.getElementById('deleteSelectedText');
    const count = this.selectedPlayerIds.size;

    if (btn) {
      if (count > 0) {
        btn.style.display = 'inline-flex';
        if (textEl) textEl.textContent = `選択した選手を削除 (${count}名)`;
      } else {
        btn.style.display = 'none';
      }
    }
  }

  // 選択した選手を一括削除（選んで削除）
  deleteSelectedPlayers() {
    const count = this.selectedPlayerIds.size;
    if (count === 0) return;

    if (!confirm(`選択された ${count} 名の選手データを削除しますか？\nこの操作は元に戻せません。`)) {
      return;
    }

    this.players = this.players.filter(p => !this.selectedPlayerIds.has(p.id));
    this.selectedPlayerIds.clear();
    this.saveToStorage();
    this.updateDeleteSelectedBtn();
    this.render();
  }

  // まとめて削除（現在表示チーム / 全チーム）
  deleteBatchPlayers(scope) {
    const menu = document.getElementById('batchDeleteMenu');
    if (menu) menu.classList.remove('show');

    if (scope === 'current') {
      if (this.selectedPlayerTeam === 'all') {
        if (!confirm(`現在「全チーム」が選択されています。\n全チームの登録選手（合計 ${this.players.length} 名）を一括削除しますか？`)) {
          return;
        }
        this.players = [];
        this.selectedPlayerIds.clear();
      } else {
        const team = this.teams.find(t => t.id === this.selectedPlayerTeam);
        const teamName = team ? team.name : '選択チーム';
        const targets = this.players.filter(p => p.teamId === this.selectedPlayerTeam);
        if (targets.length === 0) {
          alert(`「${teamName}」に登録されている選手はいません。`);
          return;
        }
        if (!confirm(`「${teamName}」の全選手（${targets.length}名）を一括削除しますか？`)) {
          return;
        }
        this.players = this.players.filter(p => p.teamId !== this.selectedPlayerTeam);
        targets.forEach(p => this.selectedPlayerIds.delete(p.id));
      }
    } else if (scope === 'all') {
      if (this.players.length === 0) {
        alert('登録されている選手はいません。');
        return;
      }
      if (!confirm(`全チームの全選手（合計 ${this.players.length} 名）を一括削除しますか？\n※この操作は取り消せません。`)) {
        return;
      }
      this.players = [];
      this.selectedPlayerIds.clear();
    }

    this.saveToStorage();
    this.updateDeleteSelectedBtn();
    this.render();
  }

  // ==========================================
  // モーダルハンドラ (共通・試合・チーム等)
  // ==========================================
  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('show');
  }

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('show');
  }

  openSingleGameModal(gameId = null, presetAwayId = null, presetHomeId = null, presetRound = null) {
    if (this.teams.length < 2) {
      alert('試合を登録するには少なくとも2チーム必要です。');
      return;
    }

    const titleEl = document.getElementById('singleGameModalTitle');
    const editIdEl = document.getElementById('editGameId');
    const roundEl = document.getElementById('gameRoundInput');
    const dateEl = document.getElementById('gameDateInput');
    const stadiumEl = document.getElementById('gameStadiumInput');
    const awaySelect = document.getElementById('gameAwayTeamSelect');
    const homeSelect = document.getElementById('gameHomeTeamSelect');
    const awayScoreEl = document.getElementById('gameAwayScoreInput');
    const homeScoreEl = document.getElementById('gameHomeScoreInput');
    const awayStarterEl = document.getElementById('gameAwayStarterInput');
    const homeStarterEl = document.getElementById('gameHomeStarterInput');
    const winPitcherEl = document.getElementById('gameWinPitcherInput');
    const losePitcherEl = document.getElementById('gameLosePitcherInput');
    const savePitcherEl = document.getElementById('gameSavePitcherInput');
    const hrEl = document.getElementById('gameHomeRunsInput');
    const notesEl = document.getElementById('gameNotesInput');

    let awayOptions = '';
    let homeOptions = '';
    this.teams.forEach(t => {
      awayOptions += `<option value="${t.id}">${this.escapeHTML(t.name)}</option>`;
      homeOptions += `<option value="${t.id}">${this.escapeHTML(t.name)}</option>`;
    });
    awaySelect.innerHTML = awayOptions;
    homeSelect.innerHTML = homeOptions;

    if (gameId) {
      const game = this.games.find(g => g.id === gameId);
      if (!game) return;
      titleEl.innerHTML = `<i class="ph ph-pencil-simple"></i> 第${game.round}回戦 試合結果の編集`;
      editIdEl.value = game.id;
      roundEl.value = game.round || 1;
      dateEl.value = game.date || '';
      stadiumEl.value = game.stadium || '';
      awaySelect.value = game.awayTeamId;
      homeSelect.value = game.homeTeamId;
      awayScoreEl.value = game.awayScore;
      homeScoreEl.value = game.homeScore;
      awayStarterEl.value = game.awayStarter || '';
      homeStarterEl.value = game.homeStarter || '';
      winPitcherEl.value = game.winPitcher || '';
      losePitcherEl.value = game.losePitcher || '';
      savePitcherEl.value = game.savePitcher || '';
      hrEl.value = game.homeRuns || '';
      notesEl.value = game.notes || '';
    } else {
      titleEl.innerHTML = `<i class="ph ph-plus-circle"></i> 新規試合結果の記録`;
      editIdEl.value = '';
      roundEl.value = presetRound || 1;
      dateEl.value = new Date().toISOString().slice(0, 10);
      stadiumEl.value = '';
      
      awaySelect.value = presetAwayId || this.teams[0].id;
      homeSelect.value = presetHomeId || (this.teams[1] ? this.teams[1].id : this.teams[0].id);
      
      awayScoreEl.value = 0;
      homeScoreEl.value = 0;
      awayStarterEl.value = '';
      homeStarterEl.value = '';
      winPitcherEl.value = '';
      losePitcherEl.value = '';
      savePitcherEl.value = '';
      hrEl.value = '';
      notesEl.value = '';
    }

    roundEl.max = this.settings.gamesPerMatch;
    this.openModal('singleGameModal');
  }

  handleMatchupTeamsChange() {
    const away = document.getElementById('gameAwayTeamSelect').value;
    const home = document.getElementById('gameHomeTeamSelect').value;
    if (away === home) {
      const otherTeam = this.teams.find(t => t.id !== away);
      if (otherTeam) document.getElementById('gameHomeTeamSelect').value = otherTeam.id;
    }
  }

  handleSaveSingleGame(event) {
    event.preventDefault();
    const id = document.getElementById('editGameId').value;
    const round = parseInt(document.getElementById('gameRoundInput').value, 10) || 1;
    const date = document.getElementById('gameDateInput').value;
    const stadium = document.getElementById('gameStadiumInput').value.trim();
    const awayTeamId = document.getElementById('gameAwayTeamSelect').value;
    const homeTeamId = document.getElementById('gameHomeTeamSelect').value;
    const awayScore = parseInt(document.getElementById('gameAwayScoreInput').value, 10) || 0;
    const homeScore = parseInt(document.getElementById('gameHomeScoreInput').value, 10) || 0;
    const awayStarter = document.getElementById('gameAwayStarterInput').value.trim();
    const homeStarter = document.getElementById('gameHomeStarterInput').value.trim();
    const winPitcher = document.getElementById('gameWinPitcherInput').value.trim();
    const losePitcher = document.getElementById('gameLosePitcherInput').value.trim();
    const savePitcher = document.getElementById('gameSavePitcherInput').value.trim();
    const homeRuns = document.getElementById('gameHomeRunsInput').value.trim();
    const notes = document.getElementById('gameNotesInput').value.trim();

    if (awayTeamId === homeTeamId) {
      alert('先攻と後攻には異なるチームを選択してください。');
      return;
    }

    const gameData = {
      id: id || ('game_' + Date.now()),
      round,
      date,
      stadium,
      awayTeamId,
      homeTeamId,
      awayScore,
      homeScore,
      awayStarter,
      homeStarter,
      winPitcher,
      losePitcher,
      savePitcher,
      homeRuns,
      notes,
      isResultEntered: true  // 試合結果入力済みフラグ（順位表集計に使用）
    };

    if (id) {
      const idx = this.games.findIndex(g => g.id === id);
      if (idx !== -1) this.games[idx] = gameData;
    } else {
      this.games.push(gameData);
    }

    this.saveToStorage();
    this.closeModal('singleGameModal');
    this.render();

    const cardModal = document.getElementById('cardGamesModal');
    if (cardModal && cardModal.classList.contains('show')) {
      this.openCardGamesModal(awayTeamId, homeTeamId);
    }
  }

  deleteGame(gameId) {
    if (!confirm('この試合記録を削除しますか？')) return;
    this.games = this.games.filter(g => g.id !== gameId);
    this.saveToStorage();
    this.render();

    const cardModal = document.getElementById('cardGamesModal');
    if (cardModal && cardModal.classList.contains('show')) {
      this.closeModal('cardGamesModal');
    }
  }

  openCardGamesModal(teamAId, teamBId) {
    const teamA = this.teams.find(t => t.id === teamAId);
    const teamB = this.teams.find(t => t.id === teamBId);
    if (!teamA || !teamB) return;

    const titleEl = document.getElementById('cardGamesModalTitle');
    const headerDisplay = document.getElementById('cardGamesHeaderDisplay');
    const addNewBtn = document.getElementById('cardAddNewGameBtn');
    const openSummaryBtn = document.getElementById('cardOpenSummaryEditBtn');
    const roundsContainer = document.getElementById('cardRoundsListGrid');

    titleEl.innerHTML = `<i class="ph ph-sword"></i> ${teamA.shortName} vs ${teamB.shortName} (全${this.settings.gamesPerMatch}回戦)`;

    const rec = this.getMatchRecord(teamAId, teamBId);
    const remaining = Math.max(0, this.settings.gamesPerMatch - rec.totalGames);

    headerDisplay.innerHTML = `
      <div class="match-team-card">
        <div class="team-badge-circle" style="background-color: ${teamA.color || '#3b82f6'}; width: 44px; height: 44px; font-size: 1.1rem;">
          ${teamA.icon || teamA.shortName.charAt(0)}
        </div>
        <span class="match-team-name">${this.escapeHTML(teamA.name)}</span>
        <span style="font-size: 0.82rem; font-weight:700; color: var(--color-win);">${rec.wins} 勝</span>
      </div>

      <div style="text-align: center;">
        <div class="match-vs-badge">VS</div>
        <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.25rem;">
          ${rec.totalGames} / ${this.settings.gamesPerMatch} 試合消化 (残 ${remaining})
        </div>
      </div>

      <div class="match-team-card">
        <div class="team-badge-circle" style="background-color: ${teamB.color || '#10b981'}; width: 44px; height: 44px; font-size: 1.1rem;">
          ${teamB.icon || teamB.shortName.charAt(0)}
        </div>
        <span class="match-team-name">${this.escapeHTML(teamB.name)}</span>
        <span style="font-size: 0.82rem; font-weight:700; color: var(--color-lose);">${rec.losses} 勝</span>
      </div>
    `;

    const cardGames = this.games.filter(g =>
      (g.awayTeamId === teamAId && g.homeTeamId === teamBId) ||
      (g.awayTeamId === teamBId && g.homeTeamId === teamAId)
    );

    const roundMap = {};
    cardGames.forEach(g => { roundMap[g.round] = g; });

    let roundsHtml = '';
    for (let r = 1; r <= this.settings.gamesPerMatch; r++) {
      const g = roundMap[r];
      if (g) {
        const away = this.teams.find(t => t.id === g.awayTeamId);
        const home = this.teams.find(t => t.id === g.homeTeamId);
        roundsHtml += `
          <div class="round-item-card" onclick="app.openSingleGameModal('${g.id}')">
            <div class="round-item-header">
              <strong style="color: var(--accent-gold);">第${r}回戦</strong>
              <span>${g.date || '-'}</span>
            </div>
            <div class="round-item-score">
              ${away.shortName} ${g.awayScore} - ${g.homeScore} ${home.shortName}
            </div>
            <div class="round-item-pitchers">
              ${g.winPitcher ? `【勝】${this.escapeHTML(g.winPitcher)} ` : ''}
              ${g.losePitcher ? `【敗】${this.escapeHTML(g.losePitcher)}` : ''}
            </div>
          </div>
        `;
      } else {
        roundsHtml += `
          <div class="round-item-card unplayed" onclick="app.openSingleGameModal(null, '${teamAId}', '${teamBId}', ${r})">
            <div class="round-item-header">
              <strong>第${r}回戦</strong>
              <span style="color: var(--text-muted);">未消化</span>
            </div>
            <div class="round-item-score" style="color: var(--text-muted); font-size: 0.9rem;">
              + クリックして入力
            </div>
          </div>
        `;
      }
    }
    roundsContainer.innerHTML = roundsHtml;

    addNewBtn.onclick = () => {
      let nextRound = 1;
      for (let r = 1; r <= this.settings.gamesPerMatch; r++) {
        if (!roundMap[r]) { nextRound = r; break; }
      }
      this.openSingleGameModal(null, teamAId, teamBId, nextRound);
    };

    openSummaryBtn.onclick = () => {
      this.openMatchModal(teamAId, teamBId);
    };

    this.openModal('cardGamesModal');
  }

  // --- チームモーダル ---
  openTeamModal(teamId = null) {
    const modalTitle = document.getElementById('teamModalTitle');
    const editTeamId = document.getElementById('editTeamId');
    const nameInput = document.getElementById('teamNameInput');
    const shortInput = document.getElementById('teamShortInput');
    const colorInput = document.getElementById('teamColorInput');
    const colorHex = document.getElementById('teamColorHex');
    const iconInput = document.getElementById('teamIconInput');

    if (teamId) {
      const team = this.teams.find(t => t.id === teamId);
      if (!team) return;
      modalTitle.innerHTML = '<i class="ph ph-shield"></i> チーム情報の編集';
      editTeamId.value = team.id;
      nameInput.value = team.name;
      shortInput.value = team.shortName;
      colorInput.value = team.color || '#3b82f6';
      colorHex.value = (team.color || '#3b82f6').toUpperCase();
      iconInput.value = team.icon || '';
    } else {
      modalTitle.innerHTML = '<i class="ph ph-plus-circle"></i> 新規チームの追加';
      editTeamId.value = '';
      nameInput.value = '';
      shortInput.value = '';
      const defaultColors = ['#EF4444', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899'];
      const randomColor = defaultColors[Math.floor(Math.random() * defaultColors.length)];
      colorInput.value = randomColor;
      colorHex.value = randomColor;
      iconInput.value = '';
    }

    this.openModal('teamModal');
  }

  handleSaveTeam(event) {
    event.preventDefault();
    const id = document.getElementById('editTeamId').value;
    const name = document.getElementById('teamNameInput').value.trim();
    const shortName = document.getElementById('teamShortInput').value.trim();
    const color = document.getElementById('teamColorInput').value;
    const icon = document.getElementById('teamIconInput').value.trim() || shortName.charAt(0);

    if (!name || !shortName) {
      alert('チーム名と略称は必須です。');
      return;
    }

    if (id) {
      const index = this.teams.findIndex(t => t.id === id);
      if (index !== -1) {
        this.teams[index] = { ...this.teams[index], name, shortName, color, icon };
      }
    } else {
      const newId = 'team_' + Date.now();
      this.teams.push({
        id: newId,
        name,
        shortName,
        color,
        icon,
        manualStats: { wins: 0, losses: 0, draws: 0, runs: 0, runsAgainst: 0 }
      });
    }

    this.saveToStorage();
    this.closeModal('teamModal');
    this.render();
  }

  deleteTeam(teamId) {
    const team = this.teams.find(t => t.id === teamId);
    if (!team) return;

    if (confirm(`チーム「${team.name}」を削除しますか？\n関連する対戦成績、試合記録、所属選手も削除されます。`)) {
      this.teams = this.teams.filter(t => t.id !== teamId);
      this.games = this.games.filter(g => g.awayTeamId !== teamId && g.homeTeamId !== teamId);
      this.players = this.players.filter(p => p.teamId !== teamId);
      const updatedMatches = {};
      for (const k in this.matches) {
        if (!k.includes(teamId)) updatedMatches[k] = this.matches[k];
      }
      this.matches = updatedMatches;
      this.saveToStorage();
      this.render();
    }
  }

  // --- 対戦成績サマリーモーダル ---
  openMatchModal(teamAId, teamBId) {
    const teamA = this.teams.find(t => t.id === teamAId);
    const teamB = this.teams.find(t => t.id === teamBId);
    if (!teamA || !teamB) return;

    document.getElementById('matchTeamAId').value = teamAId;
    document.getElementById('matchTeamBId').value = teamBId;

    const badgeA = document.getElementById('matchTeamABadge');
    const nameA = document.getElementById('matchTeamAName');
    const badgeB = document.getElementById('matchTeamBBadge');
    const nameB = document.getElementById('matchTeamBName');
    const povLabel = document.getElementById('matchTeamAPovLabel');
    const maxGamesDisp = document.getElementById('matchMaxGamesDisplay');

    if (badgeA) {
      badgeA.style.backgroundColor = teamA.color || '#3b82f6';
      badgeA.textContent = teamA.icon || teamA.shortName.charAt(0);
    }
    if (nameA) nameA.textContent = teamA.name;
    if (povLabel) povLabel.textContent = teamA.shortName;

    if (badgeB) {
      badgeB.style.backgroundColor = teamB.color || '#10b981';
      badgeB.textContent = teamB.icon || teamB.shortName.charAt(0);
    }
    if (nameB) nameB.textContent = teamB.name;

    if (maxGamesDisp) maxGamesDisp.textContent = this.settings.gamesPerMatch;

    const rec = this.getMatchRecord(teamAId, teamBId);
    document.getElementById('matchWinsInput').value = rec.wins;
    document.getElementById('matchLossesInput').value = rec.losses;
    document.getElementById('matchDrawsInput').value = rec.draws;
    document.getElementById('matchRunsInput').value = rec.runs;
    document.getElementById('matchRunsAgainstInput').value = rec.runsAgainst;

    document.getElementById('matchWinsInput').max = this.settings.gamesPerMatch;
    document.getElementById('matchLossesInput').max = this.settings.gamesPerMatch;
    document.getElementById('matchDrawsInput').max = this.settings.gamesPerMatch;

    this.validateMatchTotals();
    this.openModal('matchModal');
  }

  validateMatchTotals() {
    const w = parseInt(document.getElementById('matchWinsInput').value, 10) || 0;
    const l = parseInt(document.getElementById('matchLossesInput').value, 10) || 0;
    const d = parseInt(document.getElementById('matchDrawsInput').value, 10) || 0;
    const total = w + l + d;
    const limit = this.settings.gamesPerMatch;
    const badge = document.getElementById('matchCurrentTotalBadge');
    const saveBtn = document.getElementById('saveMatchBtn');

    if (badge) {
      const rem = Math.max(0, limit - total);
      badge.textContent = `現在合計: ${total} 試合 (残 ${rem} 試合)`;
      if (total > limit) {
        badge.style.color = 'var(--color-lose)';
        badge.textContent = `⚠️ 対戦数超過: ${total} / ${limit} 試合`;
        if (saveBtn) saveBtn.disabled = true;
      } else {
        badge.style.color = 'var(--text-primary)';
        if (saveBtn) saveBtn.disabled = false;
      }
    }
  }

  quickAddMatch(type) {
    const wInput = document.getElementById('matchWinsInput');
    const lInput = document.getElementById('matchLossesInput');
    const dInput = document.getElementById('matchDrawsInput');
    const runsInput = document.getElementById('matchRunsInput');
    const raInput = document.getElementById('matchRunsAgainstInput');

    let w = parseInt(wInput.value, 10) || 0;
    let l = parseInt(lInput.value, 10) || 0;
    let d = parseInt(dInput.value, 10) || 0;
    let r = parseInt(runsInput.value, 10) || 0;
    let ra = parseInt(raInput.value, 10) || 0;

    if (w + l + d >= this.settings.gamesPerMatch) {
      alert(`1カードあたりの最大試合数 (${this.settings.gamesPerMatch}回戦) に達しています。`);
      return;
    }

    if (type === 'win') {
      wInput.value = w + 1;
      runsInput.value = r + 4;
      raInput.value = ra + 2;
    } else if (type === 'lose') {
      lInput.value = l + 1;
      runsInput.value = r + 2;
      raInput.value = ra + 4;
    } else if (type === 'draw') {
      dInput.value = d + 1;
      runsInput.value = r + 3;
      raInput.value = ra + 3;
    }
    this.validateMatchTotals();
  }

  quickResetMatch() {
    document.getElementById('matchWinsInput').value = 0;
    document.getElementById('matchLossesInput').value = 0;
    document.getElementById('matchDrawsInput').value = 0;
    document.getElementById('matchRunsInput').value = 0;
    document.getElementById('matchRunsAgainstInput').value = 0;
    this.validateMatchTotals();
  }

  handleSaveMatch(event) {
    event.preventDefault();
    const teamAId = document.getElementById('matchTeamAId').value;
    const teamBId = document.getElementById('matchTeamBId').value;
    const wins = parseInt(document.getElementById('matchWinsInput').value, 10) || 0;
    const losses = parseInt(document.getElementById('matchLossesInput').value, 10) || 0;
    const draws = parseInt(document.getElementById('matchDrawsInput').value, 10) || 0;
    const runs = parseInt(document.getElementById('matchRunsInput').value, 10) || 0;
    const runsAgainst = parseInt(document.getElementById('matchRunsAgainstInput').value, 10) || 0;

    if (wins + losses + draws > this.settings.gamesPerMatch) {
      alert(`対戦回数の上限（${this.settings.gamesPerMatch}回戦）を超えています。`);
      return;
    }

    this.saveMatchRecord(teamAId, teamBId, wins, losses, draws, runs, runsAgainst);
    this.closeModal('matchModal');
  }

  // --- チーム成績直接手動編集 ---
  openTeamStatsModal(teamId) {
    const team = this.teams.find(t => t.id === teamId);
    if (!team) return;

    document.getElementById('statsTeamId').value = teamId;
    document.getElementById('statsTeamName').textContent = team.name;
    const badge = document.getElementById('statsTeamBadge');
    if (badge) {
      badge.style.backgroundColor = team.color || '#3b82f6';
      badge.textContent = team.icon || team.shortName.charAt(0);
    }

    const currentStats = this.calculateTeamStats(team);
    document.getElementById('statsWins').value = currentStats.wins;
    document.getElementById('statsLosses').value = currentStats.losses;
    document.getElementById('statsDraws').value = currentStats.draws;
    document.getElementById('statsRuns').value = currentStats.runs;
    document.getElementById('statsRA').value = currentStats.runsAgainst;

    this.openModal('teamStatsModal');
  }

  handleSaveTeamStats(event) {
    event.preventDefault();
    const teamId = document.getElementById('statsTeamId').value;
    const team = this.teams.find(t => t.id === teamId);
    if (!team) return;

    const wins = parseInt(document.getElementById('statsWins').value, 10) || 0;
    const losses = parseInt(document.getElementById('statsLosses').value, 10) || 0;
    const draws = parseInt(document.getElementById('statsDraws').value, 10) || 0;
    const runs = parseInt(document.getElementById('statsRuns').value, 10) || 0;
    const runsAgainst = parseInt(document.getElementById('statsRA').value, 10) || 0;

    team.manualStats = { wins, losses, draws, runs, runsAgainst };

    if (this.settings.syncMode) {
      if (confirm('順位表から直接編集した数値を反映するために「対戦表との自動連動」を手動編集モードに切り替えますか？')) {
        this.settings.syncMode = false;
      }
    }

    this.saveToStorage();
    this.closeModal('teamStatsModal');
    this.render();
  }

  // --- 設定 ---
  openSettingsModal() {
    document.getElementById('leagueNameInput').value = this.settings.leagueName;
    document.getElementById('gamesPerMatchInput').value = this.settings.gamesPerMatch;
    document.getElementById('tiebreakerSelect').value = this.settings.tiebreaker;
    this.openModal('settingsModal');
  }

  handleSaveSettings(event) {
    event.preventDefault();
    const leagueName = document.getElementById('leagueNameInput').value.trim() || 'ペナントレース 順位表';
    const gamesPerMatch = parseInt(document.getElementById('gamesPerMatchInput').value, 10) || 27;
    const tiebreaker = document.getElementById('tiebreakerSelect').value;

    this.settings.leagueName = leagueName;
    this.settings.gamesPerMatch = gamesPerMatch;
    this.settings.tiebreaker = tiebreaker;

    this.saveToStorage();
    this.closeModal('settingsModal');
    this.render();
  }

  toggleSyncMode(checked) {
    this.settings.syncMode = checked;
    this.saveToStorage();
    this.render();
  }

  resetAllScores() {
    if (!confirm('すべての対戦成績、個別試合記録、チーム勝敗数、選手成績を0にリセットしますか？')) return;
    this.matches = {};
    this.games = [];
    this.teams.forEach(t => {
      t.manualStats = { wins: 0, losses: 0, draws: 0, runs: 0, runsAgainst: 0 };
    });
    this.players.forEach(p => {
      if (p.batting) {
        Object.keys(p.batting).forEach(k => p.batting[k] = 0);
      }
      if (p.pitching) {
        Object.keys(p.pitching).forEach(k => p.pitching[k] = 0);
      }
    });
    this.saveToStorage();
    this.render();
  }

  // --- テーマ切替 ---
  toggleTheme() {
    this.theme = this.theme === 'dark' ? 'light' : 'dark';
    this.applyTheme();
    this.saveToStorage();
  }

  applyTheme() {
    const icon = document.getElementById('themeIcon');
    if (this.theme === 'light') {
      document.body.classList.remove('dark-theme');
      document.body.classList.add('light-theme');
      if (icon) icon.className = 'ph ph-moon';
    } else {
      document.body.classList.remove('light-theme');
      document.body.classList.add('dark-theme');
      if (icon) icon.className = 'ph ph-sun';
    }
  }

  // --- データ管理 ---
  openDataModal() {
    const state = {
      settings: this.settings,
      teams: this.teams,
      matches: this.matches,
      games: this.games,
      players: this.players
    };
    const jsonArea = document.getElementById('jsonTextarea');
    if (jsonArea) jsonArea.value = JSON.stringify(state, null, 2);
    this.openModal('dataModal');
  }

  exportJSON() {
    const state = {
      settings: this.settings,
      teams: this.teams,
      matches: this.matches,
      games: this.games,
      players: this.players,
      exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `npb_baseball_data_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  exportCSV() {
    const standings = this.getSortedStandings();
    let csv = '\uFEFF順位,チーム名,略称,試合数,勝利,敗戦,引分,勝率,ゲーム差,得点,失点,得失点差,貯金,残試合\n';
    standings.forEach(t => {
      const pctFormatted = t.pct >= 1.0 ? '1.000' : (t.pct === 0 ? '.000' : t.pct.toFixed(3).substring(1));
      csv += `${t.rank},"${t.name}","${t.shortName}",${t.games},${t.wins},${t.losses},${t.draws},${pctFormatted},${t.gbStr},${t.runs},${t.runsAgainst},${t.diff},${t.margin},${t.remainingGames}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `npb_standings_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  importJSON(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        this.applyImportedData(data);
      } catch (err) {
        alert('無効なJSONファイルです: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  loadFromTextarea() {
    const jsonArea = document.getElementById('jsonTextarea');
    if (!jsonArea) return;
    try {
      const data = JSON.parse(jsonArea.value);
      this.applyImportedData(data);
    } catch (err) {
      alert('無効なJSONフォーマットです: ' + err.message);
    }
  }

  applyImportedData(data) {
    if (data.teams && Array.isArray(data.teams)) {
      this.teams = data.teams;
      if (data.settings) this.settings = { ...this.settings, ...data.settings };
      if (data.matches) this.matches = data.matches;
      if (data.games) this.games = data.games;
      if (data.players) this.players = data.players;
      this.saveToStorage();
      this.render();
      this.closeModal('dataModal');
      alert('データを正常に復元しました。');
    } else {
      alert('データの形式が正しくありません。');
    }
  }

  escapeHTML(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ==========================================
  // アクセスカウンター (本日 & 総アクセス数)
  // ==========================================
  async initVisitorCounter() {
    try {
      // 一意なビジターIDの取得または生成 (永続化)
      let visitorId = localStorage.getItem('npb_visitor_id');
      if (!visitorId) {
        visitorId = 'v_' + Math.random().toString(36).substring(2, 12) + '_' + Date.now();
        localStorage.setItem('npb_visitor_id', visitorId);
      }

      // 訪問カウントAPIを呼び出し
      const res = await fetch('/api/stats/visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitor_id: visitorId })
      });

      if (res.ok) {
        const data = await res.json();
        this.updateCounterUI(data.today, data.total);
      } else {
        // フォールバック: カウントなしの統計取得
        const fallbackRes = await fetch('/api/stats');
        if (fallbackRes.ok) {
          const fallbackData = await fallbackRes.json();
          this.updateCounterUI(fallbackData.today, fallbackData.total);
        }
      }
    } catch (e) {
      console.log('アクセスカウンター: ローカルまたは静的ホスト環境です');
      this.updateCounterUI('-', '-');
    }
  }

  updateCounterUI(today, total) {
    const todayFormatted = typeof today === 'number' ? today.toLocaleString() : today;
    const totalFormatted = typeof total === 'number' ? total.toLocaleString() : total;

    const todayHeader = document.getElementById('todayVisitsHeader');
    const totalHeader = document.getElementById('totalVisitsHeader');
    const todayFooter = document.getElementById('todayVisitsFooter');
    const totalFooter = document.getElementById('totalVisitsFooter');

    if (todayHeader) todayHeader.textContent = todayFormatted;
    if (totalHeader) totalHeader.textContent = totalFormatted;
    if (todayFooter) todayFooter.textContent = todayFormatted;
    if (totalFooter) totalFooter.textContent = totalFormatted;
  }
}

// アプリケーション起動
let app;
document.addEventListener('DOMContentLoaded', () => {
  app = new NPBStandingsApp();
  window.app = app;
});
