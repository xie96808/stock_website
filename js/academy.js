// ========== ACADEMY ==========
import { disposeQuizCharts, startQuiz } from './quiz.js';

export function showAcademy() {
    document.getElementById('startScreen').style.display = 'none';
    document.getElementById('academyScreen').classList.add('active');
    // Always start at landing
    document.getElementById('academyLanding').style.display = 'block';
    document.getElementById('knowledgeZone').style.display = 'none';
    document.getElementById('trainingZone').style.display = 'none';
    document.getElementById('trainingResults').style.display = 'none';
}

export function hideAcademy() {
    document.getElementById('academyScreen').classList.remove('active');
    document.getElementById('startScreen').style.display = 'flex';
    disposeQuizCharts();
}

export function switchTab(btn, tabId) {
    document.querySelectorAll('.academy-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.pattern-grid').forEach(g => g.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(tabId).classList.add('active');
}

export function enterKnowledgeZone() {
    document.getElementById('academyLanding').style.display = 'none';
    document.getElementById('knowledgeZone').style.display = 'block';
}

export function enterTrainingZone() {
    document.getElementById('academyLanding').style.display = 'none';
    document.getElementById('trainingResults').style.display = 'none';
    document.getElementById('trainingZone').style.display = 'block';
    startQuiz();
}

export function backToAcademyLanding() {
    document.getElementById('knowledgeZone').style.display = 'none';
    document.getElementById('trainingZone').style.display = 'none';
    document.getElementById('trainingResults').style.display = 'none';
    document.getElementById('academyLanding').style.display = 'block';
    disposeQuizCharts();
}
