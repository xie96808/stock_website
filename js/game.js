// ========== GAME FUNCTIONS ==========
import { gameState, chartRefs } from './state.js';
import { calculateMA, applyChartTheme } from './utils.js';
import { endGame } from './result.js';

const MOODS = [
    '市场在等待你的判断…',
    '行情正在醇酿之中…',
    '机会稍纵即逝，请谨慎决策',
    '趋势已初现端倬',
    '多空博弈进入关键时刻',
    '资金在悄悄流动…',
    '谁能预测下一根K线？',
    '坚守还是离场，考验人心',
    '市场永远有最后一次机会',
    '最后冲刺阶段，决策至关重要'
];
