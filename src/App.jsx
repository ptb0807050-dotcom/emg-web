import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, ReferenceArea,
  AreaChart, Area, Brush
} from 'recharts';
import { 
  Activity, Upload, Info, Crosshair, 
  BarChart, ShieldCheck, Layers, Waves,
  Home, ArrowLeft, ArrowUpRight, ArrowRight, Music, 
  ListMusic, Database, FolderOpen, PlaySquare,
  Save, Edit2, Trash2, Download, FileSpreadsheet,
  Settings2, Link, Eye, User, UserPlus, Users, CheckCircle
} from 'lucide-react';

// --- 全域常數與設定 ---
const MUSCLE_LIST = [
  'R_SCM', 'L_SCM', 'R_CE', 'L_CE', 'R_UT', 
  'L_UT', 'R_LT', 'L_LT', 'R_SA', 'L_SA'
];

const GLOBAL_EMG_MAPPINGS = [
  { key: 'R_SCM', ch: 'CH1',  side: 'Right', color: 'indigo' },
  { key: 'R_UT',  ch: 'CH2',  side: 'Right', color: 'indigo' },
  { key: 'R_LT',  ch: 'CH3',  side: 'Right', color: 'indigo' },
  { key: 'L_CE',  ch: 'CH4',  side: 'Left',  color: 'emerald' },
  { key: 'L_SA',  ch: 'CH5',  side: 'Left',  color: 'emerald' },
  { key: 'R_SA',  ch: 'CH9',  side: 'Right', color: 'indigo' },
  { key: 'R_CE',  ch: 'CH10', side: 'Right', color: 'indigo' },
  { key: 'L_LT',  ch: 'CH11', side: 'Left',  color: 'emerald' },
  { key: 'L_UT',  ch: 'CH12', side: 'Left',  color: 'emerald' },
  { key: 'L_SCM', ch: 'CH13', side: 'Left',  color: 'emerald' }
];

const SIDE_MAPPINGS = {
  Right: {
    emg: GLOBAL_EMG_MAPPINGS.filter(m => m.side === 'Right').map(m => ({
      key: m.key, label: `${m.ch} (${m.key})`, regex: new RegExp(`${m.ch}\\b|${m.key}`, 'i')
    })),
    kin: [
      { key: 'RScapUpDownRotation', label: 'RScapUpDownRotation', regex: /RScapUpDownRotation|RScapUpDown/i },
      { key: 'RScapAntPosTilt', label: 'RScapAntPosTilt', regex: /RScapAntPosTilt|RScapAntPos/i },
      { key: 'RScapIntExtRotation', label: 'RScapIntExtRotation', regex: /RScapIntExtRotation|RScapIntExt/i },
      { key: 'CervicalF./E.', label: 'CervicalF./E.', regex: /CervicalF\.?\/E\.|CervicalF/i },
      { key: 'CervicalRot.', label: 'CervicalRot.', regex: /CervicalRot\.?|CervicalRot/i },
      { key: 'CervicalSB.', label: 'CervicalSB.', regex: /CervicalSB\.?|CervicalSB/i }
    ]
  },
  Left: {
    emg: GLOBAL_EMG_MAPPINGS.filter(m => m.side === 'Left').map(m => ({
      key: m.key, label: `${m.ch} (${m.key})`, regex: new RegExp(`${m.ch}\\b|${m.key}`, 'i')
    })),
    kin: [
      { key: 'LScapUpDownRotation', label: 'LScapUpDownRotation', regex: /LScapUpDownRotation|LScapUpDown/i },
      { key: 'LScapAntPosTilt', label: 'LScapAntPosTilt', regex: /LScapAntPosTilt|LScapAntPos/i },
      { key: 'LScapIntExtRotation', label: 'LScapIntExtRotation', regex: /LScapIntExtRotation|LScapIntExt/i },
      { key: 'CervicalF./E.', label: 'CervicalF./E.', regex: /CervicalF\.?\/E\.|CervicalF/i },
      { key: 'CervicalRot.', label: 'CervicalRot.', regex: /CervicalRot\.?|CervicalRot/i },
      { key: 'CervicalSB.', label: 'CervicalSB.', regex: /CervicalSB\.?|CervicalSB/i }
    ]
  }
};

// --- 動態載入 Excel (SheetJS) 函式庫 (優化：單一實例 Promise 防止重複載入) ---
let xlsxLoadPromise = null;
const loadXLSX = () => {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!xlsxLoadPromise) {
    xlsxLoadPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = () => resolve(window.XLSX);
      s.onerror = () => {
        xlsxLoadPromise = null; // 失敗時允許重試
        reject(new Error('無法載入 Excel 匯出模組，請檢查網路連線'));
      };
      document.head.appendChild(s);
    });
  }
  return xlsxLoadPromise;
};

// --- 數位信號處理 (DSP) 與數學工具函數 ---
const calcMean = (arr) => {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
};

const calcSD = (arr, mean) => {
  if (!arr || arr.length < 2) return 0;
  const variance = arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (arr.length - 1);
  return Math.sqrt(variance);
};

// 實作 2階 Butterworth Biquad 濾波器 (優化：確保輸入為 Float64Array 提升效能)
const biquadFilter = (data, type, cutoff, sampleRate) => {
  const input = data instanceof Float64Array ? data : Float64Array.from(data);
  const omega = 2 * Math.PI * cutoff / sampleRate;
  const cosW = Math.cos(omega);
  let alpha;
  let b0, b1, b2, a0, a1, a2;

  if (type === 'notch') {
    const q = 10; 
    alpha = Math.sin(omega) / (2 * q);
    b0 = 1;
    b1 = -2 * cosW;
    b2 = 1;
    a0 = 1 + alpha;
    a1 = -2 * cosW;
    a2 = 1 - alpha;
  } else {
    alpha = Math.sin(omega) / (2 * 0.7071); 
    if (type === 'lowpass') {
      b0 = (1 - cosW) / 2;
      b1 = 1 - cosW;
      b2 = (1 - cosW) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cosW;
      a2 = 1 - alpha;
    } else if (type === 'highpass') {
      b0 = (1 + cosW) / 2;
      b1 = -(1 + cosW);
      b2 = (1 + cosW) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cosW;
      a2 = 1 - alpha;
    } else {
      return input;
    }
  }

  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;

  const output = new Float64Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;

  for (let i = 0; i < input.length; i++) {
    const x0 = input[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    output[i] = y0;
    x2 = x1; x1 = x0;
    y2 = y1; y1 = y0;
  }
  return output;
};

// 帶通濾波器：使用串聯的高通與低通 Butterworth
const bandpassFilter = (data, lowCutoff = 30, highCutoff = 450, sampleRate = 1000) => {
  const hpFiltered = biquadFilter(data, 'highpass', lowCutoff, sampleRate);
  return biquadFilter(hpFiltered, 'lowpass', highCutoff, sampleRate);
};

// 優化：回傳新陣列，不直接 mutate 原陣列
const linearInterpolate = (arr) => {
  const n = arr.length;
  const out = new Float64Array(n);
  let firstValidIdx = -1;
  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(arr[i])) { firstValidIdx = i; break; }
  }
  
  if (firstValidIdx === -1) {
    for(let i = 0; i < n; i++) out[i] = 0;
    return out;
  }
  
  for (let i = 0; i < firstValidIdx; i++) out[i] = arr[firstValidIdx];
  out[firstValidIdx] = arr[firstValidIdx];

  let lastValidIdx = firstValidIdx;
  for (let i = firstValidIdx + 1; i < n; i++) {
    if (Number.isNaN(arr[i])) {
      let nextValidIdx = -1;
      for (let j = i + 1; j < n; j++) {
        if (!Number.isNaN(arr[j])) { nextValidIdx = j; break; }
      }
      if (nextValidIdx !== -1) {
        const startVal = arr[lastValidIdx];
        const endVal = arr[nextValidIdx];
        const steps = nextValidIdx - lastValidIdx;
        const delta = (endVal - startVal) / steps;
        for (let k = i; k < nextValidIdx; k++) {
          out[k] = startVal + delta * (k - lastValidIdx);
        }
        i = nextValidIdx - 1; 
      } else {
        for (let k = i; k < n; k++) out[k] = arr[lastValidIdx];
        break;
      }
    } else {
      out[i] = arr[i];
      lastValidIdx = i;
    }
  }
  return out;
};

const isNumericToken = (t) => {
  const v = parseFloat(t);
  return !Number.isNaN(v) && Number.isFinite(v);
};

const findHeaderAndDataStart = (lines, splitLine) => {
  let dataStartIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const tokens = splitLine(line).filter(t => t !== '');
    if (tokens.length < 2) continue;
    const numericCount = tokens.filter(isNumericToken).length;
    if (numericCount >= tokens.length * 0.8) {
      dataStartIndex = i;
      break;
    }
  }
  let headerIndex = dataStartIndex > 0 ? dataStartIndex - 1 : -1;
  return { headerIndex, dataStartIndex };
};

const guessDelimiter = (lines) => {
  const candidates = ['\t', ',', ';', '|']; 
  let bestDelimiter = '\t';
  let maxValidScore = 0;
  candidates.forEach(delim => {
    let score = 0;
    for (let i = 0; i < Math.min(lines.length, 50); i++) {
      let parts = [];
      if (delim === ',') parts = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
      else parts = lines[i].split(delim);
      
      parts = parts.map(s => s.trim()).filter(s => s !== '');
      const nums = parts.filter(isNumericToken).length;
      if (parts.length > 1 && nums >= parts.length / 2) score += parts.length;
    }
    if (score > maxValidScore) { maxValidScore = score; bestDelimiter = delim; }
  });
  if (maxValidScore === 0) return /\s+/; 
  return bestDelimiter;
};

const parseDataContent = (text) => {
  const lines = text.split(/\r?\n/);
  if (!lines.length) throw new Error("檔案內容為空！");

  const delim = guessDelimiter(lines);
  const parseLine = (line) => {
    let parts = [];
    if (delim instanceof RegExp) {
      const matches = line.match(/(?:[^\s"]+|"[^"]*")+/g);
      parts = matches || line.split(/\s+/);
    } else if (delim === ',') {
      parts = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
    } else {
      parts = line.split(delim);
    }
    return parts.map(s => s.replace(/^"|"$/g, '').trim());
  };

  const { headerIndex, dataStartIndex } = findHeaderAndDataStart(lines, parseLine);
  if (dataStartIndex === -1) throw new Error("無法在檔案中找到連續的數值矩陣！請確保數據段落正確。");

  let actualDataStartIndex = dataStartIndex + 1;
  if (actualDataStartIndex >= lines.length) actualDataStartIndex = dataStartIndex;

  const firstDataTokens = parseLine(lines[actualDataStartIndex]);
  let extractedHeaders = [];
  if (headerIndex !== -1) extractedHeaders = parseLine(lines[headerIndex]);

  let expectedCols = Math.max(firstDataTokens.length, extractedHeaders.length);
  while (expectedCols > 0 && 
         (!firstDataTokens[expectedCols - 1] || firstDataTokens[expectedCols - 1] === '') && 
         (!extractedHeaders[expectedCols - 1] || extractedHeaders[expectedCols - 1] === '')) {
    expectedCols--;
  }

  const finalHeaders = Array.from({ length: expectedCols }, (_, i) => {
    const defaultName = `第 ${i + 1} 欄`;
    return extractedHeaders[i] && extractedHeaders[i] !== '' ? extractedHeaders[i] : defaultName;
  });

  const dataLength = lines.length - actualDataStartIndex;
  const columns = Array.from({ length: expectedCols }, () => new Float64Array(dataLength));
  
  const testLine = lines[actualDataStartIndex];
  const fastDelim = testLine.includes('\t') ? '\t' : (testLine.includes(',') ? ',' : /\s+/);

  let validRowCount = 0;
  for (let i = actualDataStartIndex; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.trim().length === 0) continue;
    const tokens = typeof fastDelim === 'string' ? line.split(fastDelim) : line.trim().split(fastDelim);
    let colIdx = 0;
    for (let j = 0; j < tokens.length && colIdx < expectedCols; j++) {
      const str = tokens[j].trim();
      if (typeof fastDelim !== 'string' && str === '') continue;
      
      if (str === '') {
        columns[colIdx][validRowCount] = NaN; 
      } else {
        const val = parseFloat(str);
        columns[colIdx][validRowCount] = val === val ? val : NaN; 
      }
      colIdx++;
    }
    while (colIdx < expectedCols) {
      columns[colIdx][validRowCount] = NaN;
      colIdx++;
    }
    validRowCount++;
  }

  let interpolatedCount = 0;
  const trimmedColumns = columns.map(col => {
    const trimmed = col.slice(0, validRowCount);
    let nanCount = 0;
    for (let i = 0; i < trimmed.length; i++) {
      if (Number.isNaN(trimmed[i])) nanCount++;
    }
    interpolatedCount += nanCount;
    return linearInterpolate(trimmed); 
  });

  return { finalHeaders, trimmedColumns, validRowCount, interpolatedCount };
};

// --- MVIC 歷史數據庫模組 ---
const MvicDatabase = ({ activeSubjectId, mvicData, setMvicData, onBack }) => {
  const [modal, setModal] = useState({ isOpen: false, type: '', muscle: '', index: -1, value: '' });

  const handleEdit = (muscle, index) => {
    setModal({ isOpen: true, type: 'edit', muscle, index, value: String(mvicData[muscle][index]) });
  };
  const handleDelete = (muscle, index) => {
    setModal({ isOpen: true, type: 'delete', muscle, index, value: '' });
  };
  const handleClearMuscle = (muscle) => {
    if (mvicData[muscle].length > 0) {
      setModal({ isOpen: true, type: 'clear', muscle, index: -1, value: '' });
    }
  };

  const confirmModal = () => {
    const { type, muscle, index, value } = modal;
    const newData = { ...mvicData };
    if (type === 'edit') {
      const parsedVal = parseFloat(value);
      if (!isNaN(parsedVal)) {
        newData[muscle] = [...newData[muscle]];
        newData[muscle][index] = parsedVal;
        setMvicData(newData);
      }
    } else if (type === 'delete') {
      newData[muscle] = newData[muscle].filter((_, i) => i !== index);
      setMvicData(newData);
    } else if (type === 'clear') {
      newData[muscle] = [];
      setMvicData(newData);
    }
    setModal({ isOpen: false, type: '', muscle: '', index: -1, value: '' });
  };

  return (
    <div className="min-h-screen bg-[#f1f5f9] p-6 font-sans text-slate-800 animate-in fade-in duration-500 relative">
      {modal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl p-6 w-full max-w-sm animate-in zoom-in-95 duration-200">
            <h3 className="text-xl font-bold text-slate-900 mb-2">
              {modal.type === 'edit' && '修改測試數據'}
              {modal.type === 'delete' && '刪除測試數據'}
              {modal.type === 'clear' && '清空肌肉數據'}
            </h3>
            <div className="text-sm text-slate-600 mb-6 mt-4">
              {modal.type === 'edit' && (
                <div>
                  <p className="mb-3 font-medium text-slate-700">請輸入 <span className="text-indigo-600 font-bold">{modal.muscle}</span> 第 {modal.index + 1} 次的新數值 (mV)：</p>
                  <input 
                    type="number" value={modal.value} onChange={(e) => setModal((prev) => ({ ...prev, value: e.target.value }))}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono text-lg" autoFocus
                  />
                </div>
              )}
              {modal.type === 'delete' && <p>確定要刪除 <span className="text-indigo-600 font-bold">{modal.muscle}</span> 的第 {modal.index + 1} 次數據嗎？<br/><br/>此操作無法復原。</p>}
              {modal.type === 'clear' && <p>確定要清空 <span className="text-indigo-600 font-bold">{modal.muscle}</span> 的所有數據嗎？<br/><br/>此操作無法復原。</p>}
            </div>
            <div className="flex justify-end gap-3 mt-2">
              <button onClick={() => setModal({ isOpen: false, type: '', muscle: '', index: -1, value: '' })} className="px-5 py-2.5 rounded-xl text-slate-500 hover:bg-slate-100 font-bold transition-colors">取消</button>
              <button onClick={confirmModal} className={`px-5 py-2.5 rounded-xl text-white font-bold transition-colors shadow-sm ${modal.type === 'edit' ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-rose-500 hover:bg-rose-600'}`}>確定{modal.type === 'edit' ? '修改' : '刪除'}</button>
            </div>
          </div>
        </div>
      )}

      <header className="max-w-7xl mx-auto flex items-center gap-4 bg-white p-6 rounded-3xl shadow-sm border border-slate-100 mb-6">
        <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500 hover:text-slate-800">
          <ArrowLeft size={24} />
        </button>
        <div className="bg-emerald-500 p-3 rounded-2xl shadow-lg text-white">
          <FolderOpen className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">MVIC 歷史數據庫</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded text-[10px] font-bold">
              受測者: {activeSubjectId}
            </span>
            <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">MVIC Database & Results (Mean RMS)</p>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold text-sm">
              <tr>
                <th className="p-5">目標肌肉</th>
                <th className="p-5">Trial 1 (mV)</th>
                <th className="p-5">Trial 2 (mV)</th>
                <th className="p-5">Trial 3 (mV)</th>
                <th className="p-5 bg-indigo-50 text-indigo-800">3次測試平均</th>
                <th className="p-5 bg-indigo-50 text-indigo-800">標準差 (SD)</th>
                <th className="p-5 text-center">操作</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {MUSCLE_LIST.map((muscle) => {
                const trials = mvicData[muscle];
                const mean = calcMean(trials);
                const sd = calcSD(trials, mean);
                return (
                  <tr key={muscle} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                    <td className="p-5 font-bold text-slate-800 flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${trials.length === 3 ? 'bg-emerald-500' : (trials.length > 0 ? 'bg-amber-400' : 'bg-slate-300')}`}></div>
                      {muscle}
                    </td>
                    {[0, 1, 2].map((idx) => (
                      <td key={idx} className="p-5 font-mono">
                        {trials[idx] !== undefined ? (
                          <div className="flex items-center gap-3 group">
                            <span className="font-semibold text-slate-700">{trials[idx].toFixed(4)}</span>
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => handleEdit(muscle, idx)} className="text-blue-500 hover:bg-blue-50 p-1 rounded"><Edit2 size={14}/></button>
                              <button onClick={() => handleDelete(muscle, idx)} className="text-rose-500 hover:bg-rose-50 p-1 rounded"><Trash2 size={14}/></button>
                            </div>
                          </div>
                        ) : ( <span className="text-slate-300">-</span> )}
                      </td>
                    ))}
                    <td className="p-5 font-mono font-bold text-indigo-700 bg-indigo-50/30">{trials.length > 0 ? mean.toFixed(4) : '-'}</td>
                    <td className="p-5 font-mono font-bold text-indigo-700 bg-indigo-50/30">{trials.length > 1 ? sd.toFixed(4) : (trials.length === 1 ? '0.0000' : '-')}</td>
                    <td className="p-5 text-center">
                      <button 
                        onClick={() => handleClearMuscle(muscle)} 
                        disabled={trials.length === 0}
                        className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-colors ${trials.length > 0 ? 'text-rose-600 hover:bg-rose-50' : 'text-slate-300 cursor-not-allowed'}`}
                      >清除全部</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
};

// --- 任務數據總表 (Task Database) 模組 ---
const TaskDatabase = ({ 
  activeSubjectId,
  taskLiftEmgData, setTaskLiftEmgData, taskLiftAngleData, setTaskLiftAngleData,
  taskOpenStringData, setTaskOpenStringData,
  taskScaleData, setTaskScaleData,
  taskMusicData, setTaskMusicData,
  onBack 
}) => {
  const [activeTask, setActiveTask] = useState('lifting'); // 'lifting' | 'openstring' | 'scale' | 'music'
  const [activeTab, setActiveTab] = useState('emg'); // 'emg' | 'angle'
  const [modal, setModal] = useState({ isOpen: false, target: '', type: '' });

  const tasks = {
    lifting: { id: 'lifting', name: '舉手任務', icon: <ArrowUpRight size={18} />, emg: taskLiftEmgData, angle: taskLiftAngleData, setEmg: setTaskLiftEmgData, setAngle: setTaskLiftAngleData },
    openstring: { id: 'openstring', name: '空弦演奏', icon: <Music size={18} />, emg: taskOpenStringData, angle: {}, setEmg: setTaskOpenStringData, setAngle: () => {} },
    scale: { id: 'scale', name: '音階演奏', icon: <ListMusic size={18} />, emg: taskScaleData, angle: {}, setEmg: setTaskScaleData, setAngle: () => {} },
    music: { id: 'music', name: '樂曲演奏', icon: <PlaySquare size={18} />, emg: taskMusicData, angle: {}, setEmg: setTaskMusicData, setAngle: () => {} }
  };

  const handleClear = (target, type) => {
    setModal({ isOpen: true, target, type });
  };

  const confirmClear = () => {
    const currentTaskActions = tasks[activeTask];
    if (modal.type === 'emg') {
      currentTaskActions.setEmg(prev => ({ ...prev, [modal.target]: [] }));
    } else {
      currentTaskActions.setAngle(prev => ({ ...prev, [modal.target]: [] }));
    }
    setModal({ isOpen: false, target: '', type: '' });
  };

  const currentTaskData = tasks[activeTask];
  const currentData = activeTab === 'emg' ? currentTaskData.emg : currentTaskData.angle;
  const displayKeys = Object.keys(currentData).filter(k => currentData[k] && currentData[k].length > 0);

  const getMean = (trials, phase) => {
    const validVals = trials.map(t => t[phase]).filter(v => v !== undefined && v !== '');
    if (validVals.length === 0) return '-';
    return (validVals.reduce((a, b) => a + parseFloat(b), 0) / validVals.length).toFixed(4);
  };

  return (
    <div className="min-h-screen bg-[#f1f5f9] p-6 font-sans text-slate-800 animate-in fade-in duration-500 relative">
      {modal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl p-6 w-full max-w-sm animate-in zoom-in-95 duration-200">
            <h3 className="text-xl font-bold text-slate-900 mb-2">清空任務數據</h3>
            <p className="text-sm text-slate-600 mb-6 mt-4">
              確定要清空 <span className="font-bold text-rose-600">{modal.target}</span> 的所有儲存數據嗎？此操作無法復原。
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setModal({ isOpen: false, target: '', type: '' })} className="px-5 py-2.5 rounded-xl text-slate-500 hover:bg-slate-100 font-bold transition-colors">取消</button>
              <button onClick={confirmClear} className="px-5 py-2.5 rounded-xl text-white font-bold transition-colors shadow-sm bg-rose-500 hover:bg-rose-600">確定刪除</button>
            </div>
          </div>
        </div>
      )}

      <header className="max-w-7xl mx-auto flex items-center gap-4 bg-white p-6 rounded-3xl shadow-sm border border-slate-100 mb-6">
        <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500 hover:text-slate-800">
          <ArrowLeft size={24} />
        </button>
        <div className="bg-blue-500 p-3 rounded-2xl shadow-lg text-white">
          <Database className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">任務數據總表</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-[10px] font-bold">
              受測者: {activeSubjectId}
            </span>
            <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">Task Database & Segment Results</p>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto space-y-4">
        <div className="flex flex-wrap gap-3 pb-2">
          {Object.values(tasks).map(task => (
            <button
              key={task.id}
              onClick={() => { setActiveTask(task.id); setActiveTab('emg'); }}
              className={`px-5 py-2.5 rounded-2xl font-bold transition-all flex items-center gap-2 text-sm shadow-sm ${activeTask === task.id ? 'bg-slate-800 text-white' : 'bg-white text-slate-500 hover:bg-slate-50 border border-slate-200'}`}
            >
              {task.icon} {task.name}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-3 pb-2">
          <button 
            onClick={() => setActiveTab('emg')} 
            className={`px-6 py-2.5 rounded-2xl font-bold transition-all flex items-center gap-2 text-sm shadow-sm ${activeTab === 'emg' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-500 hover:bg-indigo-50 border border-slate-200'}`}
          >
            <Activity size={18} /> EMG 肌肉活化數據
          </button>
          <button 
            onClick={() => setActiveTab('angle')} 
            className={`px-6 py-2.5 rounded-2xl font-bold transition-all flex items-center gap-2 text-sm shadow-sm ${activeTab === 'angle' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-500 hover:bg-emerald-50 border border-slate-200'}`}
          >
            <Eye size={18} /> 觀察關節角度數據
          </button>
        </div>

        <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden min-h-[400px]">
          {displayKeys.length === 0 ? (
            <div className="p-20 text-center flex flex-col items-center justify-center h-full">
              <Database size={64} className="text-slate-200 mb-4" />
              <h3 className="text-lg font-bold text-slate-400">「{currentTaskData.name} - {activeTab === 'emg' ? 'EMG' : '觀察角度'}」尚無儲存數據</h3>
              <p className="text-sm text-slate-400 mt-2">請先前往對應的分析模組進行分析並批次寫入資料庫。</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold text-sm">
                  <tr>
                    <th className="p-5">{activeTab === 'emg' ? '目標肌肉' : '觀察通道'}</th>
                    <th className="p-5">動作階段 (Phase)</th>
                    <th className="p-5">Trial 1</th>
                    <th className="p-5">Trial 2</th>
                    <th className="p-5">Trial 3</th>
                    <th className={`p-5 text-white ${activeTab === 'emg' ? 'bg-indigo-500' : 'bg-emerald-500'}`}>3次測試平均</th>
                    <th className={`p-5 text-white ${activeTab === 'emg' ? 'bg-indigo-400' : 'bg-emerald-400'}`}>標準差 (SD)</th>
                  </tr>
                </thead>
                <tbody className="text-sm divide-y divide-slate-100">
                  {displayKeys.map(targetKey => {
                    const trials = currentData[targetKey];
                    let phases = ['Overall'];
                    if (activeTask === 'lifting') {
                      phases = activeTab === 'emg' 
                        ? ['Up_30-60', 'Up_60-90', 'Up_90-120', 'Down_120-90', 'Down_90-60', 'Down_60-30']
                        : ['Up_30', 'Up_60', 'Up_90', 'Down_90', 'Down_60', 'Down_30'];
                    }
                    
                    return phases.map((phase, pIdx) => {
                      let t1, t2, t3, mean, sd;
                      if (activeTask === 'lifting') {
                        t1 = trials[0]?.[phase];
                        t2 = trials[1]?.[phase];
                        t3 = trials[2]?.[phase];
                        mean = getMean(trials, phase);
                        const validVals = trials.map(t => t[phase]).filter(v => v !== undefined && v !== '').map(Number);
                        sd = validVals.length > 1 ? calcSD(validVals, parseFloat(mean)).toFixed(4) : '-';
                      } else {
                        t1 = trials[0];
                        t2 = trials[1];
                        t3 = trials[2];
                        const validVals = trials.filter(v => v !== undefined && v !== '').map(Number);
                        mean = validVals.length > 0 ? (validVals.reduce((a,b)=>a+b,0)/validVals.length).toFixed(4) : '-';
                        sd = validVals.length > 1 ? calcSD(validVals, parseFloat(mean)).toFixed(4) : '-';
                      }
                      
                      const isEmg = activeTab === 'emg';
                      const formattedPhase = phase.replace('_', ' ');

                      return (
                        <tr key={`${targetKey}-${phase}`} className="hover:bg-slate-50 transition-colors">
                          {pIdx === 0 && (
                            <td rowSpan={phases.length} className="p-5 align-top border-r border-slate-100 bg-white">
                              <div className="font-bold text-slate-800 text-base">{targetKey}</div>
                              <div className="mt-1.5 flex items-center gap-2">
                                <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${isEmg ? 'bg-indigo-100 text-indigo-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                  已存 {trials.length}/3 次
                                </span>
                              </div>
                              <button 
                                onClick={() => handleClear(targetKey, activeTab)} 
                                className="mt-4 flex items-center gap-1 text-xs font-bold text-rose-500 hover:text-rose-600 hover:underline transition-colors"
                              >
                                <Trash2 size={14} /> 清除此目標
                              </button>
                            </td>
                          )}
                          <td className="p-5 font-bold text-slate-600 border-r border-slate-50 bg-slate-50/30">
                            {formattedPhase}{activeTask === 'lifting' ? '°' : ''}
                          </td>
                          <td className="p-5 font-mono text-slate-700">{t1 !== undefined && t1 !== '' ? t1 : <span className="text-slate-300">-</span>}</td>
                          <td className="p-5 font-mono text-slate-700">{t2 !== undefined && t2 !== '' ? t2 : <span className="text-slate-300">-</span>}</td>
                          <td className="p-5 font-mono text-slate-700">{t3 !== undefined && t3 !== '' ? t3 : <span className="text-slate-300">-</span>}</td>
                          <td className={`p-5 font-mono font-bold ${isEmg ? 'text-indigo-700 bg-indigo-50/40' : 'text-emerald-700 bg-emerald-50/40'}`}>
                            {mean !== '-' ? mean : <span className="text-slate-300">-</span>}
                          </td>
                          <td className={`p-5 font-mono font-bold ${isEmg ? 'text-indigo-600 bg-indigo-50/20' : 'text-emerald-600 bg-emerald-50/20'}`}>
                            {sd !== '-' ? sd : <span className="text-slate-300">-</span>}
                          </td>
                        </tr>
                      );
                    });
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

// --- 舉手動作分析 (Lifting Task) 模組 ---
const LiftingAnalysis = ({ activeSubjectId, onBack, taskLiftEmgData, setTaskLiftEmgData, taskLiftAngleData, setTaskLiftAngleData }) => {
  const [emgFileResult, setEmgFileResult] = useState(null);
  const [emgHeaders, setEmgHeaders] = useState([]);
  const [kinFileResult, setKinFileResult] = useState(null);
  const [kinHeaders, setKinHeaders] = useState([]);

  const [errorMessage, setErrorMessage] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);

  const [taskSide, setTaskSide] = useState('Right');
  const [emgMapping, setEmgMapping] = useState({});
  const [kinMapping, setKinMapping] = useState({});
  
  const [previewEmgKey, setPreviewEmgKey] = useState('');
  const [previewKinKey, setPreviewKinKey] = useState('');

  const [kinAngleColIdx, setKinAngleColIdx] = useState(1);
  const [kinTrigColIdx, setKinTrigColIdx] = useState(-1);
  const [kinTrigThresh, setKinTrigThresh] = useState(2.0);

  const [emgSR, setEmgSR] = useState(1000);
  const [kinSR, setKinSR] = useState(200); 
  
  const [kinOnsetConsecutive, setKinOnsetConsecutive] = useState(50);
  const [bpHigh, setBpHigh] = useState(30);
  const [bpLow, setBpLow] = useState(450);
  const [lpfCutoff, setLpfCutoff] = useState(20); 
  
  const [notchFilter, setNotchFilter] = useState(true);
  const [ecgFilter, setEcgFilter] = useState(false);

  const [analysisResult, setAnalysisResult] = useState(null);
  const [selectedRepIdx, setSelectedRepIdx] = useState(0);
  const [draggingMarker, setDraggingMarker] = useState(null);

  const autoMap = useCallback((side, eHeaders, kHeaders) => {
    const eMap = {};
    SIDE_MAPPINGS[side].emg.forEach(m => {
      const idx = eHeaders.findIndex(h => m.regex.test(h));
      eMap[m.key] = idx !== -1 ? idx : -1;
    });
    const kMap = {};
    SIDE_MAPPINGS[side].kin.forEach(m => {
      const idx = kHeaders.findIndex(h => m.regex.test(h));
      kMap[m.key] = idx !== -1 ? idx : -1;
    });
    setEmgMapping(eMap);
    setKinMapping(kMap);
    setPreviewEmgKey(SIDE_MAPPINGS[side].emg[0].key);
    setPreviewKinKey(SIDE_MAPPINGS[side].kin[0].key);
  }, []);

  const handleEmgUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const { finalHeaders, trimmedColumns, interpolatedCount } = parseDataContent(e.target.result);
        setEmgHeaders(finalHeaders);
        setEmgFileResult(trimmedColumns);
        autoMap(taskSide, finalHeaders, kinHeaders);
        setErrorMessage(null);
        if (interpolatedCount > 0) {
          showToast(`⚠️ 偵測到 ${interpolatedCount} 筆 EMG 遺失數據，已自動線性插值修復！`);
        }
      } catch (err) { setErrorMessage(`EMG 解析失敗: ${err.message}`); }
    };
    reader.readAsText(file);
  };

  const handleKinUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const { finalHeaders, trimmedColumns, interpolatedCount } = parseDataContent(e.target.result);
        setKinHeaders(finalHeaders);
        setKinFileResult(trimmedColumns);
        
        const trigIdx = finalHeaders.findIndex(h => h.toLowerCase().includes('trigger') || h.toLowerCase().includes('trig'));
        setKinTrigColIdx(trigIdx !== -1 ? trigIdx : -1);

        const rhtIdx = finalHeaders.findIndex(h => h.replace(/[^a-zA-Z]/g, '').toLowerCase().includes('rhtelevation'));
        if (rhtIdx !== -1) setKinAngleColIdx(rhtIdx);

        autoMap(taskSide, emgHeaders, finalHeaders);

        setErrorMessage(null);
        if (interpolatedCount > 0) {
          showToast(`⚠️ 偵測到 ${interpolatedCount} 筆 Kinematic 遺失數據，已自動線性插值修復！`);
        }
      } catch (err) { setErrorMessage(`Kinematic 解析失敗: ${err.message}`); }
    };
    reader.readAsText(file);
  };

  const buildCycleMetrics = (cycle, localEmgSR, localKinSR, kinAngleData, emgProcessedMap, currentKinMapping, kinFileResultObj, kinTIdx) => {
    const getUpIdx = (startI, endI, threshold) => {
       for(let i=startI; i<=endI; i++) if (kinAngleData[i] >= threshold) return i;
       return null;
    };
    const getDownIdx = (startI, endI, threshold) => {
       if (kinAngleData[startI] < threshold) return null; 
       for(let i=startI; i<=endI; i++) if (kinAngleData[i] <= threshold) return i;
       return null;
    };

    let i30_up = getUpIdx(cycle.startIdx, cycle.peakIdx, 30);
    let i60_up = getUpIdx(i30_up || cycle.startIdx, cycle.peakIdx, 60);
    let i90_up = getUpIdx(i60_up || cycle.startIdx, cycle.peakIdx, 90);
    let i120_up = getUpIdx(i90_up || cycle.startIdx, cycle.peakIdx, 120);

    let i120_down = getDownIdx(cycle.peakIdx, cycle.endIdx, 120);
    let i90_down = getDownIdx(i120_down || cycle.peakIdx, cycle.endIdx, 90);
    let i60_down = getDownIdx(i90_down || cycle.peakIdx, cycle.endIdx, 60);
    let i30_down = getDownIdx(i60_down || cycle.peakIdx, cycle.endIdx, 30);

    const emgSegmentsAll = {};
    Object.entries(emgProcessedMap).forEach(([key, data]) => {
      const calcEmgSegment = (sIdx, eIdx) => {
        if (sIdx === null || eIdx === null || sIdx >= eIdx) return '';
        const emgStart = Math.max(0, Math.floor((sIdx - kinTIdx) / localKinSR * localEmgSR));
        const emgEnd = Math.min(data.filtered.length - 1, Math.floor((eIdx - kinTIdx) / localKinSR * localEmgSR));
        
        let sumSq = 0, countRms = 0;
        for(let i = emgStart; i <= emgEnd && i < data.filtered.length; i++) { 
          sumSq += Math.pow(data.filtered[i], 2); 
          countRms++; 
        }
        return countRms > 0 ? +(Math.sqrt(sumSq / countRms)).toFixed(4) : '';
      };

      emgSegmentsAll[key] = {
        'Up_30-60': calcEmgSegment(i30_up, i60_up),
        'Up_60-90': calcEmgSegment(i60_up, i90_up),
        'Up_90-120': calcEmgSegment(i90_up, i120_up),
        'Down_120-90': calcEmgSegment(i120_down, i90_down),
        'Down_90-60': calcEmgSegment(i90_down, i60_down),
        'Down_60-30': calcEmgSegment(i60_down, i30_down)
      };
    });

    const kinPointsAll = {};
    Object.entries(currentKinMapping).forEach(([key, colIdx]) => {
      if (colIdx !== -1 && kinFileResultObj[colIdx]) {
        const extraData = kinFileResultObj[colIdx];
        const getKinValue = (idx) => {
          if (idx === null || idx >= extraData.length) return '';
          return +(extraData[idx]).toFixed(2);
        };
        kinPointsAll[key] = {
          'Up_30': getKinValue(i30_up),
          'Up_60': getKinValue(i60_up),
          'Up_90': getKinValue(i90_up),
          'Down_90': getKinValue(i90_down),
          'Down_60': getKinValue(i60_down),
          'Down_30': getKinValue(i30_down)
        };
      }
    });

    const pkAngle = kinAngleData[cycle.peakIdx];
    const angleTimes = {
      t30_up: i30_up !== null ? +( (i30_up - kinTIdx) / localKinSR ).toFixed(3) : null,
      t60_up: i60_up !== null ? +( (i60_up - kinTIdx) / localKinSR ).toFixed(3) : null,
      t90_up: i90_up !== null ? +( (i90_up - kinTIdx) / localKinSR ).toFixed(3) : null,
      t120_up: i120_up !== null ? +( (i120_up - kinTIdx) / localKinSR ).toFixed(3) : null,
      t120_down: i120_down !== null ? +( (i120_down - kinTIdx) / localKinSR ).toFixed(3) : null,
      t90_down: i90_down !== null ? +( (i90_down - kinTIdx) / localKinSR ).toFixed(3) : null,
      t60_down: i60_down !== null ? +( (i60_down - kinTIdx) / localKinSR ).toFixed(3) : null,
      t30_down: i30_down !== null ? +( (i30_down - kinTIdx) / localKinSR ).toFixed(3) : null,
    };

    return {
      ...cycle,
      maxAngle: pkAngle.toFixed(1),
      duration: +( (cycle.endIdx - cycle.startIdx) / localKinSR ).toFixed(2),
      emgSegmentsAll,
      kinPointsAll,
      angleTimes
    };
  };

  const processLiftingTask = () => {
    if (!emgFileResult || !kinFileResult) {
      setErrorMessage("請先載入 EMG 與 KINEMATIC 兩個檔案！"); return;
    }
    setErrorMessage(null); setAnalysisResult(null); setSelectedRepIdx(0);

    const kinTriggerData = kinFileResult[kinTrigColIdx];
    const kinAngleData = kinFileResult[kinAngleColIdx];

    let kinTrigIdx = 0;
    if (kinTrigColIdx !== -1 && kinTriggerData) {
      for (let i = 0; i < kinTriggerData.length; i++) {
        if (kinTriggerData[i] >= kinTrigThresh) { kinTrigIdx = i; break; }
      }
    }

    const detectedCycles = [];
    let firstOnsetIdx = -1;
    let consecutiveUp = 0;
    
    for (let i = 1; i < kinAngleData.length; i++) {
      const delta = kinAngleData[i] - kinAngleData[i-1];
      if (delta > 0) {
        consecutiveUp++;
        if (consecutiveUp >= kinOnsetConsecutive) {
          firstOnsetIdx = i - kinOnsetConsecutive + 1;
          break;
        }
      } else {
        consecutiveUp = 0;
      }
    }

    if (firstOnsetIdx === -1) {
      setErrorMessage(`無法在資料中找到連續 ${kinOnsetConsecutive} 筆上升的起點 (Onset)，請調整連續筆數。`);
      return;
    }

    let currentStartIdx = firstOnsetIdx;

    // 優化：加入最短時間限制 (過濾假動作)，並防止相同結束點重複加入
    while (currentStartIdx < kinAngleData.length - 1 && detectedCycles.length < 3) {
      let peakIdx = currentStartIdx;
      let maxAngle = kinAngleData[currentStartIdx];
      for (let i = currentStartIdx + 1; i < kinAngleData.length; i++) {
        if (kinAngleData[i] > maxAngle) {
          maxAngle = kinAngleData[i];
          peakIdx = i;
        } else if (maxAngle - kinAngleData[i] > 10) { break; }
      }

      let endIdx = peakIdx;
      let minAngle = kinAngleData[peakIdx];
      for (let i = peakIdx + 1; i < kinAngleData.length; i++) {
        if (kinAngleData[i] < minAngle) {
          minAngle = kinAngleData[i];
          endIdx = i;
        } else if (kinAngleData[i] - minAngle > 10) { break; }
      }

      const durationSamples = endIdx - currentStartIdx;
      const minDurationSamples = kinSR * 0.5; // 0.5s minimum duration

      if (maxAngle - kinAngleData[currentStartIdx] >= 15 && durationSamples > minDurationSamples) {
        detectedCycles.push({ startIdx: currentStartIdx, peakIdx: peakIdx, endIdx: endIdx });
      } else if (maxAngle - kinAngleData[currentStartIdx] < 15) { 
        break; 
      }
      
      if (endIdx === peakIdx || endIdx >= kinAngleData.length - 1) { break; }
      currentStartIdx = endIdx;
    }

    if (detectedCycles.length === 0) {
      setErrorMessage(`無法找出符合條件的完整動作過程。`);
      return;
    }

    const emgProcessed = {};
    Object.entries(emgMapping).forEach(([key, colIdx]) => {
      if (colIdx !== -1 && emgFileResult[colIdx]) {
        let raw = emgFileResult[colIdx];
        if (notchFilter) {
          raw = biquadFilter(raw, 'notch', 60, emgSR);
        }
        let currentBpHigh = ecgFilter ? Math.max(30, bpHigh) : bpHigh;
        const filtered = bandpassFilter(raw, currentBpHigh, bpLow, emgSR);
        const rectified = new Float64Array(filtered.length);
        for(let i=0; i<filtered.length; i++) rectified[i] = Math.abs(filtered[i]);
        const envelope = biquadFilter(rectified, 'lowpass', lpfCutoff, emgSR); 
        emgProcessed[key] = { filtered, envelope };
      }
    });

    const cycleMetrics = detectedCycles.map((cycle, index) => {
      const baseCycle = {
        id: index + 1,
        startIdx: cycle.startIdx,
        peakIdx: cycle.peakIdx,
        endIdx: cycle.endIdx,
        tStart: +( (cycle.startIdx - kinTrigIdx) / kinSR ).toFixed(3),
        tPeak: +( (cycle.peakIdx - kinTrigIdx) / kinSR ).toFixed(3),
        tEnd: +( (cycle.endIdx - kinTrigIdx) / kinSR ).toFixed(3),
      };
      return buildCycleMetrics(baseCycle, emgSR, kinSR, kinAngleData, emgProcessed, kinMapping, kinFileResult, kinTrigIdx);
    });

    const chartData = [];
    const fullDurationSamples = kinAngleData.length;
    // 優化：圖表降採樣，最多渲染 4000 點防止瀏覽器卡頓
    const MAX_CHART_POINTS = 4000;
    const step = Math.max(1, Math.floor(fullDurationSamples / MAX_CHART_POINTS));

    for (let i = 0; i < fullDurationSamples; i += step) {
      const t = (i - kinTrigIdx) / kinSR; 
      const matchingEmgIdx = Math.floor(t * emgSR); 
      
      const row = {
         time: Math.round(t * 1000) / 1000,
         angleMain: Math.round(kinAngleData[i] * 100) / 100
      };

      Object.entries(emgProcessed).forEach(([k, d]) => {
         if (matchingEmgIdx >= 0 && matchingEmgIdx < d.envelope.length) {
            row[`emg_${k}`] = Math.round(d.envelope[matchingEmgIdx] * 10000) / 10000;
         }
      });
      Object.entries(kinMapping).forEach(([k, colIdx]) => {
         if (colIdx !== -1 && kinFileResult[colIdx]) {
            row[`kin_${k}`] = Math.round(kinFileResult[colIdx][i] * 100) / 100;
         }
      });
      chartData.push(row);
    }

    setAnalysisResult({ chartData, cycles: cycleMetrics, emgProcessed, kinTrigIdx });
  };

  const showToast = (msg) => {
    setToastMessage(msg); setTimeout(() => setToastMessage(null), 3000);
  };

  const handleBatchSave = () => {
    if (!analysisResult || !analysisResult.cycles[selectedRepIdx]) return;
    const cycle = analysisResult.cycles[selectedRepIdx];
    let hasError = false;
    let savedEmg = 0;
    let savedKin = 0;

    const newEmgData = { ...taskLiftEmgData };
    Object.entries(cycle.emgSegmentsAll).forEach(([key, segs]) => {
       if (Object.values(segs).some(v => v !== '')) {
           const current = newEmgData[key] || [];
           if (current.length < 3) {
              newEmgData[key] = [...current, { ...segs }];
              savedEmg++;
           } else {
              hasError = true;
           }
       }
    });
    
    const newAngleData = { ...taskLiftAngleData };
    Object.entries(cycle.kinPointsAll).forEach(([key, pts]) => {
       if (Object.values(pts).some(v => v !== '')) {
           const current = newAngleData[key] || [];
           if (current.length < 3) {
              newAngleData[key] = [...current, { ...pts }];
              savedKin++;
           } else {
              hasError = true;
           }
       }
    });

    setTaskLiftEmgData(newEmgData);
    setTaskLiftAngleData(newAngleData);

    if (hasError) {
       showToast(`⚠️ 部分通道已達 3 次上限！其餘通道已成功寫入。`);
    } else {
       showToast(`✅ 成功批次寫入 ${savedEmg} 個 EMG 與 ${savedKin} 個 Kinematics 數據！`);
    }
  };

  const handleNextRepetition = () => {
    if (analysisResult && selectedRepIdx < analysisResult.cycles.length - 1) {
      setSelectedRepIdx(selectedRepIdx + 1);
    } else {
      showToast("⚠️ 後續沒有找到更多循環動作了！");
    }
  };

  const handleChartMouseDown = useCallback((e) => {
    if (e && analysisResult) {
      const time = e.activeLabel !== undefined ? e.activeLabel : e.activePayload?.[0]?.payload?.time;
      if (time === undefined || time === null) return;
      const cycle = analysisResult.cycles[selectedRepIdx];
      
      const dStart = Math.abs(time - cycle.tStart);
      const dPeak = Math.abs(time - cycle.tPeak);
      const dEnd = Math.abs(time - cycle.tEnd);
      
      const minD = Math.min(dStart, dPeak, dEnd);
      const tolerance = 1.0; // 放寬至 1 秒內皆可判定抓取

      if (minD < tolerance) {
        if (minD === dStart) setDraggingMarker('start');
        else if (minD === dPeak) setDraggingMarker('peak');
        else if (minD === dEnd) setDraggingMarker('end');
      }
    }
  }, [analysisResult, selectedRepIdx]);

  const handleChartMouseMove = useCallback((e) => {
    if (!draggingMarker) return;
    if (e && e.activeLabel !== undefined) {
       const time = e.activeLabel;
       // 使用 callback 方式更新 state，避免重新建立函數參考導致圖表事件斷線
       setAnalysisResult(prev => {
          if (!prev) return prev;
          const newCycles = [...prev.cycles];
          const cycle = { ...newCycles[selectedRepIdx] };

          const idx = Math.floor(time * kinSR) + prev.kinTrigIdx;
          const maxIdx = kinFileResult[kinAngleColIdx].length - 1;

          if (draggingMarker === 'start') {
             if (idx < cycle.peakIdx) { cycle.startIdx = Math.max(0, idx); cycle.tStart = time; }
          } else if (draggingMarker === 'peak') {
             if (idx > cycle.startIdx && idx < cycle.endIdx) { cycle.peakIdx = idx; cycle.tPeak = time; }
          } else if (draggingMarker === 'end') {
             if (idx > cycle.peakIdx) { cycle.endIdx = Math.min(maxIdx, idx); cycle.tEnd = time; }
          }

          const updatedCycle = buildCycleMetrics(
            cycle, emgSR, kinSR, kinFileResult[kinAngleColIdx],
            prev.emgProcessed, kinMapping, kinFileResult,
            prev.kinTrigIdx
          );

          newCycles[selectedRepIdx] = updatedCycle;
          return { ...prev, cycles: newCycles };
       });
    }
  }, [draggingMarker, selectedRepIdx, kinSR, emgSR, kinFileResult, kinAngleColIdx, kinMapping]);

  const handleChartMouseUp = useCallback(() => {
    setDraggingMarker(null);
  }, []);

  const getPreviewMeanRms = () => {
    if (!analysisResult || !analysisResult.cycles[selectedRepIdx]) return '-';
    if (!previewEmgKey || !analysisResult.emgProcessed[previewEmgKey]) return '-';
    
    const cycle = analysisResult.cycles[selectedRepIdx];
    const emgData = analysisResult.emgProcessed[previewEmgKey].filtered;
    const emgStart = Math.max(0, Math.floor((cycle.startIdx - analysisResult.kinTrigIdx) / kinSR * emgSR));
    const emgEnd = Math.min(emgData.length - 1, Math.floor((cycle.endIdx - analysisResult.kinTrigIdx) / kinSR * emgSR));
    
    let sumSq = 0, countRms = 0;
    for(let i=emgStart; i<=emgEnd && i<emgData.length; i++) { 
       sumSq += Math.pow(emgData[i], 2); 
       countRms++; 
    }
    return countRms > 0 ? +(Math.sqrt(sumSq / countRms)).toFixed(4) : '-';
  };

  const currentMetrics = analysisResult?.cycles[selectedRepIdx];
  const emgKeys = ['Up_30-60', 'Up_60-90', 'Up_90-120', 'Down_120-90', 'Down_90-60', 'Down_60-30'];
  const kinKeys = ['Up_30', 'Up_60', 'Up_90', 'Down_90', 'Down_60', 'Down_30'];

  return (
    <div className="min-h-screen bg-[#f1f5f9] p-6 font-sans text-slate-800 animate-in fade-in duration-500 relative" onMouseUp={handleChartMouseUp} onMouseLeave={handleChartMouseUp}>
      {toastMessage && (
        <div className="fixed top-8 left-1/2 transform -translate-x-1/2 z-50 bg-slate-800 text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 animate-in slide-in-from-top-4 duration-300">
          <span className="font-bold text-sm">{toastMessage}</span>
        </div>
      )}

      <header className="max-w-7xl mx-auto flex flex-col xl:flex-row justify-between items-start xl:items-center bg-white p-6 rounded-3xl shadow-sm border border-slate-100 mb-6 gap-4">
        <div className="flex items-center gap-4 shrink-0">
          <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500 hover:text-slate-800"><ArrowLeft size={24} /></button>
          <div className="bg-blue-500 p-3 rounded-2xl shadow-lg"><ArrowUpRight className="text-white w-6 h-6" /></div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">舉手動作批次分析 (Lifting)</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-[10px] font-bold">
                受測者: {activeSubjectId}
              </span>
              <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">Multi-Channel Peak-Valley Detection</p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto">
          <label className={`flex items-center gap-2 px-5 py-2.5 rounded-2xl transition-all shadow-sm cursor-pointer text-sm font-bold shrink-0 ${emgFileResult ? 'bg-indigo-100 text-indigo-700' : 'bg-indigo-600 hover:bg-indigo-700 text-white'}`}>
            <Upload size={18} /> {emgFileResult ? '已載入 EMG' : '載入 EMG 檔'}
            <input type="file" className="hidden" accept=".csv,.txt" onChange={handleEmgUpload} />
          </label>
          <label className={`flex items-center gap-2 px-5 py-2.5 rounded-2xl transition-all shadow-sm cursor-pointer text-sm font-bold shrink-0 ${kinFileResult ? 'bg-emerald-100 text-emerald-700' : 'bg-emerald-600 hover:bg-emerald-700 text-white'}`}>
            <Upload size={18} /> {kinFileResult ? '已載入 KINEMATIC' : '載入 KINEMATIC 檔'}
            <input type="file" className="hidden" accept=".csv,.txt" onChange={handleKinUpload} />
          </label>
        </div>
      </header>

      <main className="max-w-7xl mx-auto space-y-6">
        {errorMessage && ( <div className="bg-rose-50 border border-rose-200 text-rose-700 px-6 py-4 rounded-2xl font-bold flex items-center gap-3"><Info size={20} /> {errorMessage}</div> )}

        {emgFileResult && kinFileResult && (
          <div className="bg-white p-5 rounded-3xl shadow-sm border border-slate-100 space-y-4">
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
              
              <div className="bg-indigo-50/50 p-3 rounded-2xl border border-indigo-100/50 flex flex-col justify-between">
                <div>
                  <div className="text-sm font-bold text-indigo-800 mb-0.5 uppercase tracking-wide flex items-center gap-2"><Activity size={14} className="shrink-0" /> 硬體同步設定</div>
                  <p className="text-[9px] text-indigo-500 mb-2 leading-tight">Kinematic 接收 Trigger 之點 = EMG 第 0 筆</p>
                </div>
                <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
                  <div className="col-span-2"><span className="text-[10px] font-semibold text-slate-500 mb-0.5 block">Kinematic Trigger 通道:</span><select value={kinTrigColIdx} onChange={e=>setKinTrigColIdx(Number(e.target.value))} className="w-full p-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 bg-white"><option value="-1">無</option>{kinHeaders.map((h, i) => <option key={i} value={i}>{h}</option>)}</select></div>
                  <div><span className="text-[10px] font-semibold text-slate-500 mb-0.5 block">Trigger 閥值:</span><input type="number" step="0.5" value={kinTrigThresh} onChange={e=>setKinTrigThresh(Number(e.target.value))} className="w-full p-1.5 rounded-lg border border-slate-200 text-xs font-bold text-center text-rose-600 bg-white" disabled={kinTrigColIdx === -1}/></div>
                  <div><span className="text-[10px] font-semibold text-slate-500 mb-0.5 block">Kin SR (Hz):</span><input type="number" value={kinSR} onChange={e=>setKinSR(Number(e.target.value))} className="w-full p-1.5 rounded-lg border border-slate-200 text-xs font-bold text-center bg-white" /></div>
                </div>
              </div>

              <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200/50 flex flex-col justify-between">
                <div>
                  <div className="text-sm font-bold text-slate-800 mb-0.5 uppercase tracking-wide flex items-center gap-2"><Waves size={14} className="shrink-0" /> EMG 取樣設定</div>
                  <p className="text-[9px] text-slate-500 mb-2 leading-tight">起點自動對齊 Trigger 訊號</p>
                </div>
                <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
                  <div className="col-span-2 flex justify-between items-center">
                    <span className="text-[10px] font-semibold text-slate-500">SR (Hz):</span>
                    <input type="number" value={emgSR} onChange={e=>setEmgSR(Number(e.target.value))} className="w-16 p-1 rounded-lg border border-slate-200 text-xs font-bold text-center bg-white" />
                  </div>
                  <div className="col-span-2 flex items-center justify-between gap-1 mt-1">
                    <label className="flex items-center gap-1 text-[10px] font-semibold text-slate-600 cursor-pointer" title="濾除 60Hz 市電雜訊">
                      <input type="checkbox" checked={notchFilter} onChange={e=>setNotchFilter(e.target.checked)} className="accent-indigo-600"/> 60Hz 陷波
                    </label>
                    <label className="flex items-center gap-1 text-[10px] font-semibold text-slate-600 cursor-pointer" title="動態提升 High-pass 至 30Hz 濾除心跳突波">
                      <input type="checkbox" checked={ecgFilter} onChange={e=>setEcgFilter(e.target.checked)} className="accent-indigo-600"/> 抑制 ECG
                    </label>
                  </div>
                </div>
              </div>

              <div className="bg-amber-50/50 p-3 rounded-2xl border border-amber-100/50 flex flex-col justify-between">
                <div className="text-sm font-bold text-amber-800 mb-2 uppercase tracking-wide flex items-center gap-2"><Crosshair size={14} className="shrink-0" /> 主判定關節</div>
                <div className="space-y-1.5">
                  <div>
                    <span className="text-[10px] font-semibold text-slate-500 mb-0.5 block">Kin 主角度 (例如 HT elevation):</span>
                    <select value={kinAngleColIdx} onChange={e=>setKinAngleColIdx(Number(e.target.value))} className="w-full p-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 bg-white">
                      {kinHeaders.map((h, i) => <option key={i} value={i}>{h}</option>)}
                    </select>
                  </div>
                  <div><span className="text-[10px] font-semibold text-slate-500 mb-0.5 block mt-2">Onset 連續上升筆數:</span><input type="number" value={kinOnsetConsecutive} onChange={e=>setKinOnsetConsecutive(Number(e.target.value))} className="w-full p-1.5 rounded-lg border border-amber-300 text-xs font-black text-amber-700 text-center bg-white" /></div>
                </div>
              </div>

              <div className="flex items-end shrink-0">
                <button onClick={processLiftingTask} className="w-full bg-blue-600 hover:bg-blue-700 text-white p-3 h-full min-h-[84px] rounded-2xl font-bold transition-all shadow-lg active:scale-95 flex flex-col items-center justify-center gap-2 hover:shadow-blue-200">
                  <Activity size={24} /> <span className="text-sm">開始批次分析</span>
                </button>
              </div>
            </div>

            {/* 下半部：批次通道對應設定 */}
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/80 shadow-sm">
              <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 border-b border-slate-200 pb-3 gap-3">
                <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2"><Layers size={16} className="text-indigo-500" /> 批次分析通道對應 (Batch Mapping)</h4>
                <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
                   <span className="text-xs font-bold text-slate-600">測試側別 (Task Side):</span>
                   <select value={taskSide} onChange={e => { setTaskSide(e.target.value); autoMap(e.target.value, emgHeaders, kinHeaders); }} className="font-bold text-xs bg-transparent text-indigo-700 outline-none cursor-pointer">
                      <option value="Right">右手任務 (Right Side)</option>
                      <option value="Left">左手任務 (Left Side)</option>
                   </select>
                </div>
              </div>
              
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div>
                   <h5 className={`text-xs font-bold ${taskSide === 'Right' ? 'text-indigo-600' : 'text-emerald-600'} mb-2 flex items-center gap-1`}><Activity size={14}/> EMG 肌肉對應 (自動抓取 5 通道)</h5>
                   <div className="grid grid-cols-2 gap-2">
                      {SIDE_MAPPINGS[taskSide].emg.map(m => (
                         <div key={m.key} className={`flex flex-col bg-white p-2 rounded-xl border ${taskSide === 'Right' ? 'border-indigo-100' : 'border-emerald-100'} shadow-sm`}>
                            <span className="text-[10px] font-bold text-slate-500 mb-1">{m.label}</span>
                            <select value={emgMapping[m.key] ?? -1} onChange={e => setEmgMapping({...emgMapping, [m.key]: Number(e.target.value)})} className={`text-[10px] font-bold ${taskSide === 'Right' ? 'text-indigo-900 bg-indigo-50/50' : 'text-emerald-900 bg-emerald-50/50'} p-1 rounded border-none outline-none`}>
                               <option value="-1">忽略 (不分析)</option>
                               {emgHeaders.map((h, i) => <option key={i} value={i}>{h}</option>)}
                            </select>
                         </div>
                      ))}
                   </div>
                </div>
                <div>
                   <h5 className={`text-xs font-bold ${taskSide === 'Right' ? 'text-indigo-600' : 'text-emerald-600'} mb-2 flex items-center gap-1`}><Eye size={14}/> Kinematics 關節對應 (自動抓取 6 通道)</h5>
                   <div className="grid grid-cols-2 gap-2">
                      {SIDE_MAPPINGS[taskSide].kin.map(m => (
                         <div key={m.key} className={`flex flex-col bg-white p-2 rounded-xl border ${taskSide === 'Right' ? 'border-indigo-100' : 'border-emerald-100'} shadow-sm`}>
                            <span className="text-[10px] font-bold text-slate-500 mb-1">{m.label}</span>
                            <select value={kinMapping[m.key] ?? -1} onChange={e => setKinMapping({...kinMapping, [m.key]: Number(e.target.value)})} className={`text-[10px] font-bold ${taskSide === 'Right' ? 'text-indigo-900 bg-indigo-50/50' : 'text-emerald-900 bg-emerald-50/50'} p-1 rounded border-none outline-none`}>
                               <option value="-1">忽略 (不分析)</option>
                               {kinHeaders.map((h, i) => <option key={i} value={i}>{h}</option>)}
                            </select>
                         </div>
                      ))}
                   </div>
                </div>
              </div>
            </div>

          </div>
        )}

        {analysisResult && currentMetrics && (
          <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
            
            {/* 一鍵寫入資料庫大按鈕 */}
            <div className="bg-gradient-to-r from-indigo-600 to-emerald-600 p-6 rounded-3xl text-white shadow-lg flex flex-col md:flex-row justify-between items-center mb-6">
              <div className="mb-4 md:mb-0">
                <h3 className="font-black text-xl flex items-center gap-2"><Database size={24} /> 批次寫入資料庫 (Batch Save)</h3>
                <p className="text-sm text-indigo-100 mt-1 font-medium">將目前切分好的 5 個肌肉 RMS 區間與 6 個關節瞬時點，一次性完整儲存至當前受測者。</p>
              </div>
              <button onClick={handleBatchSave} className="bg-white text-indigo-800 px-8 py-3 rounded-2xl font-black shadow-xl hover:scale-105 active:scale-95 transition-all whitespace-nowrap">
                一鍵全通道儲存
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCard title={`預覽肌肉 (${previewEmgKey || '未選擇'}) 整個循環 RMS`} value={getPreviewMeanRms()} unit="mV" icon={<BarChart className="text-blue-500" />} />
              <MetricCard title={`主判定角度 (${kinHeaders[kinAngleColIdx]}) Peak`} value={currentMetrics.maxAngle} unit="°" icon={<Layers className="text-amber-500" />} />
              <MetricCard title="循環總時長 (Start to End)" value={currentMetrics.duration} unit="s" icon={<Info className="text-indigo-500" />} />
              <div className="bg-slate-800 p-4 rounded-3xl border border-slate-700 shadow-sm flex flex-col justify-center items-center text-white relative overflow-hidden group">
                <div className="absolute inset-0 bg-blue-500/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300"></div>
                <span className="text-xs font-bold text-slate-400 mb-1 relative z-10">目前檢視動作</span>
                <span className="text-3xl font-black relative z-10">{currentMetrics.id} <span className="text-sm font-medium text-slate-400">/ {analysisResult.cycles.length}</span></span>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              
              {/* EMG Preview Block */}
              <div className="bg-indigo-50 border border-indigo-200 p-6 rounded-3xl flex flex-col justify-between shadow-sm relative overflow-hidden">
                <div className="absolute -right-6 -top-6 text-indigo-500/10"><Activity size={100} /></div>
                <div>
                  <div className="flex justify-between items-start mb-4 relative z-10">
                    <div>
                      <h3 className="font-bold text-indigo-900 text-base flex items-center gap-2"><Eye size={18} className="text-indigo-600"/> EMG 區間預覽</h3>
                      <p className="text-xs text-indigo-600 font-medium mt-1">下拉切換欲預覽之肌肉 (全部肌肉都會在點擊儲存時寫入)</p>
                    </div>
                    <select value={previewEmgKey} onChange={e => setPreviewEmgKey(e.target.value)} className="px-3 py-1.5 rounded-xl border border-indigo-300 bg-white font-bold text-indigo-900 text-xs focus:outline-none shadow-sm cursor-pointer">
                      {SIDE_MAPPINGS[taskSide].emg.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                    </select>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-2 mb-2 relative z-10">
                    {emgKeys.map(phase => (
                      <div key={phase} className="bg-white rounded-xl p-2 text-center border border-indigo-100 shadow-sm">
                        <div className={`text-[10px] font-bold mb-1 ${phase.includes('Up') ? 'text-amber-500' : 'text-emerald-500'}`}>{phase.replace('_', ' ')}°</div>
                        <div className="text-sm font-black font-mono text-indigo-700">{currentMetrics.emgSegmentsAll?.[previewEmgKey]?.[phase] || '-'}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Kinematics Preview Block */}
              <div className="bg-emerald-50 border border-emerald-200 p-6 rounded-3xl flex flex-col justify-between shadow-sm relative overflow-hidden">
                <div className="absolute -right-6 -top-6 text-emerald-500/10"><Eye size={100} /></div>
                <div>
                  <div className="flex justify-between items-start mb-4 relative z-10">
                    <div>
                      <h3 className="font-bold text-emerald-900 text-base flex items-center gap-2"><Eye size={18} className="text-emerald-600"/> 觀察關節預覽</h3>
                      <p className="text-xs text-emerald-600 font-medium mt-1">下拉切換欲預覽之關節 (全部關節都會在點擊儲存時寫入)</p>
                    </div>
                    <select value={previewKinKey} onChange={e => setPreviewKinKey(e.target.value)} className="px-3 py-1.5 rounded-xl border border-emerald-300 bg-white font-bold text-emerald-900 text-xs focus:outline-none shadow-sm cursor-pointer">
                      {SIDE_MAPPINGS[taskSide].kin.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                    </select>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-2 mb-2 relative z-10">
                    {kinKeys.map(phase => (
                      <div key={phase} className="bg-white rounded-xl p-2 text-center border border-emerald-100 shadow-sm">
                        <div className={`text-[10px] font-bold mb-1 ${phase.includes('Up') ? 'text-amber-500' : 'text-emerald-500'}`}>{phase.replace('_', ' ')}°</div>
                        <div className="text-sm font-black font-mono text-emerald-700">{currentMetrics.kinPointsAll?.[previewKinKey]?.[phase] || '-'}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

            </div>

            <div className="flex items-center justify-end">
                <button
                  onClick={handleNextRepetition}
                  disabled={selectedRepIdx >= analysisResult.cycles.length - 1}
                  className={`px-6 py-2.5 rounded-xl font-bold transition-all shadow-sm flex items-center gap-2 text-sm ${
                    selectedRepIdx < analysisResult.cycles.length - 1
                      ? 'bg-slate-800 hover:bg-slate-900 text-white active:scale-95'
                      : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  }`}
                >
                  尋找下一循環動作
                  <ArrowRight size={16} />
                </button>
            </div>

            <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-md font-bold text-slate-700 flex items-center gap-2">
                <Waves size={18} className="text-indigo-500" /> 同步分析圖表預覽 (Peak-Valley 視覺化)
              </h3>
              <div className="flex items-center gap-4 text-xs font-bold">
                 <div className="flex items-center gap-1"><div className="w-3 h-3 bg-[#f59e0b] opacity-30 rounded-sm"></div> 上升階段 (Lift-up)</div>
                 <div className="flex items-center gap-1"><div className="w-3 h-3 bg-[#10b981] opacity-30 rounded-sm"></div> 下降階段 (Put-down)</div>
                 <div className="flex items-center gap-1 ml-4 text-blue-500 border border-blue-200 px-2 py-1 rounded-md bg-blue-50"><Crosshair size={12}/> 提示：可直接拖曳圖中標示線微調區間</div>
              </div>
            </div>
            
            <div className="space-y-6 select-none" style={{ cursor: draggingMarker ? 'col-resize' : 'default' }} draggable={false}>
              <div>
                <div className="flex items-center gap-3 mb-2 pl-2 border-l-2 border-indigo-400">
                  <p className="text-xs font-bold text-slate-500">EMG 圖表預覽通道:</p>
                  <select 
                    value={previewEmgKey} 
                    onChange={e => setPreviewEmgKey(e.target.value)} 
                    className="px-3 py-1 rounded-lg border border-indigo-200 bg-indigo-50 font-bold text-indigo-800 text-xs focus:outline-none shadow-sm cursor-pointer"
                  >
                    {SIDE_MAPPINGS[taskSide].emg.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                  </select>
                  <p className="text-xs font-bold text-slate-400 ml-1">LPF 包絡線</p>
                </div>
                <div className="h-[220px] w-full select-none" draggable={false}>
                  <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={analysisResult.chartData} syncId="liftingSync" onMouseDown={handleChartMouseDown} onMouseMove={handleChartMouseMove} onMouseUp={handleChartMouseUp}>
                        <defs><linearGradient id="emgFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#4f46e5" stopOpacity={0.2}/><stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/></linearGradient></defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="time" type="number" domain={['dataMin', 'dataMax']} hide />
                        <YAxis tick={{fontSize: 10}} width={40} />
                        <Tooltip contentStyle={{fontSize:'12px', borderRadius:'12px'}} labelFormatter={(l)=>`Time: ${l}s`} />
                        <ReferenceLine x={0} stroke="#ef4444" strokeDasharray="3 3" />
                        
                        {analysisResult.cycles.flatMap((cycle, idx) => {
                          const elements = [
                            <ReferenceArea key={`up-emg-${idx}`} x1={cycle.tStart} x2={cycle.tPeak} fill="#f59e0b" fillOpacity={selectedRepIdx === idx ? 0.25 : 0.05} />,
                            <ReferenceArea key={`down-emg-${idx}`} x1={cycle.tPeak} x2={cycle.tEnd} fill="#10b981" fillOpacity={selectedRepIdx === idx ? 0.25 : 0.05} />
                          ];
                          if (selectedRepIdx === idx) {
                            if (cycle.angleTimes.t30_up) elements.push(<ReferenceLine key={`t30u-emg-${idx}`} x={cycle.angleTimes.t30_up} stroke="#f59e0b" strokeWidth={1} strokeDasharray="3 3" />);
                            if (cycle.angleTimes.t60_up) elements.push(<ReferenceLine key={`t60u-emg-${idx}`} x={cycle.angleTimes.t60_up} stroke="#f59e0b" strokeWidth={1} strokeDasharray="3 3" />);
                            if (cycle.angleTimes.t90_up) elements.push(<ReferenceLine key={`t90u-emg-${idx}`} x={cycle.angleTimes.t90_up} stroke="#f59e0b" strokeWidth={1} strokeDasharray="3 3" />);
                            if (cycle.angleTimes.t120_up) elements.push(<ReferenceLine key={`t120u-emg-${idx}`} x={cycle.angleTimes.t120_up} stroke="#f59e0b" strokeWidth={1} strokeDasharray="3 3" />);
                            
                            if (cycle.angleTimes.t120_down) elements.push(<ReferenceLine key={`t120d-emg-${idx}`} x={cycle.angleTimes.t120_down} stroke="#10b981" strokeWidth={1} strokeDasharray="3 3" />);
                            if (cycle.angleTimes.t90_down) elements.push(<ReferenceLine key={`t90d-emg-${idx}`} x={cycle.angleTimes.t90_down} stroke="#10b981" strokeWidth={1} strokeDasharray="3 3" />);
                            if (cycle.angleTimes.t60_down) elements.push(<ReferenceLine key={`t60d-emg-${idx}`} x={cycle.angleTimes.t60_down} stroke="#10b981" strokeWidth={1} strokeDasharray="3 3" />);
                            if (cycle.angleTimes.t30_down) elements.push(<ReferenceLine key={`t30d-emg-${idx}`} x={cycle.angleTimes.t30_down} stroke="#10b981" strokeWidth={1} strokeDasharray="3 3" />);

                            elements.push(<ReferenceLine key={`peak-emg-${idx}`} x={cycle.tPeak} stroke="#ef4444" strokeWidth={3} strokeDasharray="5 5" style={{ cursor: 'col-resize', pointerEvents: 'none' }} label={{value:'Peak', position:'insideTopLeft', fill:'#ef4444', fontSize:10, fontWeight:'bold'}} />);
                            elements.push(<ReferenceLine key={`start-emg-${idx}`} x={cycle.tStart} stroke="#3b82f6" strokeWidth={3} style={{ cursor: 'col-resize', pointerEvents: 'none' }} label={{value:'Start', position:'insideBottomLeft', fill:'#3b82f6', fontSize:10, fontWeight:'bold'}} />);
                            elements.push(<ReferenceLine key={`end-emg-${idx}`} x={cycle.tEnd} stroke="#10b981" strokeWidth={3} style={{ cursor: 'col-resize', pointerEvents: 'none' }} label={{value:'End', position:'insideBottomRight', fill:'#10b981', fontSize:10, fontWeight:'bold'}} />);
                          }
                          return elements;
                        })}

                        <Area name={`EMG ${previewEmgKey}`} type="monotone" dataKey={`emg_${previewEmgKey}`} stroke="#4f46e5" fill="url(#emgFill)" strokeWidth={2} isAnimationActive={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-3 mb-2 pl-2 border-l-2 border-amber-500">
                    <p className="text-xs font-bold text-slate-500">Kinematic 觀察角度:</p>
                    <select 
                      value={previewKinKey} 
                      onChange={e => setPreviewKinKey(e.target.value)} 
                      className="px-3 py-1 rounded-lg border border-emerald-200 bg-emerald-50 font-bold text-emerald-800 text-xs focus:outline-none shadow-sm cursor-pointer"
                    >
                      {SIDE_MAPPINGS[taskSide].kin.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                    </select>
                    <p className="text-xs font-bold text-slate-400 ml-1">與主判定基準 (Main Angle)</p>
                  </div>
                  <div className="h-[280px] w-full select-none" draggable={false}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={analysisResult.chartData} syncId="liftingSync" onMouseDown={handleChartMouseDown} onMouseMove={handleChartMouseMove} onMouseUp={handleChartMouseUp}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="time" type="number" domain={['dataMin', 'dataMax']} tick={{fontSize: 10}} label={{value:'Time (s)', position:'insideBottom', offset:-5, fontSize:10, fill:'#94a3b8'}} />
                        <YAxis domain={['auto', 'auto']} tick={{fontSize: 10}} width={40} />
                        <Tooltip contentStyle={{fontSize:'12px', borderRadius:'12px'}} labelFormatter={(l)=>`Time: ${l}s`} />
                        <Legend wrapperStyle={{fontSize: '11px', fontWeight: 'bold'}} verticalAlign="top" height={36}/>
                        <ReferenceLine x={0} stroke="#ef4444" strokeDasharray="3 3" />
                        
                        {[30, 60, 90, 120].map(angle => (
                          <ReferenceLine key={`angle-ref-${angle}`} y={angle} stroke="#cbd5e1" strokeWidth={1} strokeDasharray="3 3" label={{value: `${angle}°`, position: 'insideLeft', fill: '#94a3b8', fontSize: 10, fontWeight: 'bold'}} />
                        ))}
                        
                        {analysisResult.cycles.flatMap((cycle, idx) => {
                          const elements = [
                            <ReferenceArea key={`up-kin-${idx}`} x1={cycle.tStart} x2={cycle.tPeak} fill="#f59e0b" fillOpacity={selectedRepIdx === idx ? 0.25 : 0.05} />,
                            <ReferenceArea key={`down-kin-${idx}`} x1={cycle.tPeak} x2={cycle.tEnd} fill="#10b981" fillOpacity={selectedRepIdx === idx ? 0.25 : 0.05} />
                          ];
                          if (selectedRepIdx === idx) {
                            if (cycle.angleTimes.t30_up) elements.push(<ReferenceLine key={`t30u-kin-${idx}`} x={cycle.angleTimes.t30_up} stroke="#f59e0b" strokeWidth={1} strokeDasharray="3 3" label={{value:'Up 30°', position:'insideTop', fill:'#f59e0b', fontSize:10}} />);
                            if (cycle.angleTimes.t60_up) elements.push(<ReferenceLine key={`t60u-kin-${idx}`} x={cycle.angleTimes.t60_up} stroke="#f59e0b" strokeWidth={1} strokeDasharray="3 3" label={{value:'Up 60°', position:'insideTop', fill:'#f59e0b', fontSize:10}} />);
                            if (cycle.angleTimes.t90_up) elements.push(<ReferenceLine key={`t90u-kin-${idx}`} x={cycle.angleTimes.t90_up} stroke="#f59e0b" strokeWidth={1} strokeDasharray="3 3" label={{value:'Up 90°', position:'insideTop', fill:'#f59e0b', fontSize:10}} />);
                            if (cycle.angleTimes.t120_up) elements.push(<ReferenceLine key={`t120u-kin-${idx}`} x={cycle.angleTimes.t120_up} stroke="#f59e0b" strokeWidth={1} strokeDasharray="3 3" label={{value:'Up 120°', position:'insideTop', fill:'#f59e0b', fontSize:10}} />);

                            if (cycle.angleTimes.t120_down) elements.push(<ReferenceLine key={`t120d-kin-${idx}`} x={cycle.angleTimes.t120_down} stroke="#10b981" strokeWidth={1} strokeDasharray="3 3" label={{value:'Dn 120°', position:'insideTop', fill:'#10b981', fontSize:10}} />);
                            if (cycle.angleTimes.t90_down) elements.push(<ReferenceLine key={`t90d-kin-${idx}`} x={cycle.angleTimes.t90_down} stroke="#10b981" strokeWidth={1} strokeDasharray="3 3" label={{value:'Dn 90°', position:'insideTop', fill:'#10b981', fontSize:10}} />);
                            if (cycle.angleTimes.t60_down) elements.push(<ReferenceLine key={`t60d-kin-${idx}`} x={cycle.angleTimes.t60_down} stroke="#10b981" strokeWidth={1} strokeDasharray="3 3" label={{value:'Dn 60°', position:'insideTop', fill:'#10b981', fontSize:10}} />);
                            if (cycle.angleTimes.t30_down) elements.push(<ReferenceLine key={`t30d-kin-${idx}`} x={cycle.angleTimes.t30_down} stroke="#10b981" strokeWidth={1} strokeDasharray="3 3" label={{value:'Dn 30°', position:'insideTop', fill:'#10b981', fontSize:10}} />);

                            elements.push(<ReferenceLine key={`peak-kin-${idx}`} x={cycle.tPeak} stroke="#ef4444" strokeWidth={3} strokeDasharray="5 5" style={{ cursor: 'col-resize', pointerEvents: 'none' }} label={{value:'Peak', position:'insideTopLeft', fill:'#ef4444', fontSize:10, fontWeight:'bold'}} />);
                            elements.push(<ReferenceLine key={`start-kin-${idx}`} x={cycle.tStart} stroke="#3b82f6" strokeWidth={3} style={{ cursor: 'col-resize', pointerEvents: 'none' }} label={{value:'Start', position:'insideBottomLeft', fill:'#3b82f6', fontSize:10, fontWeight:'bold'}} />);
                            elements.push(<ReferenceLine key={`end-kin-${idx}`} x={cycle.tEnd} stroke="#10b981" strokeWidth={3} style={{ cursor: 'col-resize', pointerEvents: 'none' }} label={{value:'End', position:'insideBottomRight', fill:'#10b981', fontSize:10, fontWeight:'bold'}} />);
                          }
                          return elements;
                        })}

                        <Line name={`主判定角度: ${kinHeaders[kinAngleColIdx]}`} type="monotone" dataKey="angleMain" stroke="#f59e0b" strokeWidth={3} dot={false} isAnimationActive={false} />
                        <Line name={`預覽觀察角度: ${previewKinKey}`} type="monotone" dataKey={`kin_${previewKinKey}`} stroke="#0ea5e9" strokeWidth={2} strokeDasharray="5 5" dot={false} isAnimationActive={false} />
                        <Brush dataKey="time" height={30} stroke="#94a3b8" fill="#f8fafc" travellerWidth={10} tickFormatter={(v) => `${v}s`} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

// --- MVIC 分析模組 ---
const MvicAnalysis = ({ activeSubjectId, onBack, mvicData, setMvicData }) => {
  const [analysisResult, setAnalysisResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [toastMessage, setToastMessage] = useState(null); 

  const [saveTarget, setSaveTarget] = useState(MUSCLE_LIST[0]);
  const [samplingRate, setSamplingRate] = useState(1000); 
  const [analysisOffsetSec, setAnalysisOffsetSec] = useState(1); 
  const [analysisDurationSec, setAnalysisDurationSec] = useState(2); 

  const [bpHigh, setBpHigh] = useState(30);
  const [bpLow, setBpLow] = useState(450);
  const [lpfCutoff, setLpfCutoff] = useState(20); 

  const [sdMultiplier, setSdMultiplier] = useState(5);
  const [consecutiveSamples, setConsecutiveSamples] = useState(10); 
  const [baselineStart, setBaselineStart] = useState(1000); 
  const [baselineLength, setBaselineLength] = useState(2000); 
  const [appliedBaseline, setAppliedBaseline] = useState(null);
  
  const [notchFilter, setNotchFilter] = useState(true);
  const [ecgFilter, setEcgFilter] = useState(false);

  const [parsedFileResult, setParsedFileResult] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [selectedColumnIndex, setSelectedColumnIndex] = useState(1); 
  const [chartKey, setChartKey] = useState(0);
  
  const [onsetSample, setOnsetSample] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const [isManualBaselineMode, setIsManualBaselineMode] = useState(false);
  const [manualBaseStart, setManualBaseStart] = useState(null);
  const [manualBaseEnd, setManualBaseEnd] = useState(null);
  const [isSelectingBase, setIsSelectingBase] = useState(false);

  // 用來自動配對目標肌肉的邏輯
  const autoSelectMuscle = useCallback((headerName) => {
    for (let m of GLOBAL_EMG_MAPPINGS) {
      const regex = new RegExp(`${m.ch}\\b|${m.key}`, 'i');
      if (regex.test(headerName)) {
        setSaveTarget(m.key);
        break;
      }
    }
  }, []);

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        setErrorMessage(null);
        setIsManualBaselineMode(false);
        setManualBaseStart(null);
        setManualBaseEnd(null);
        
        const { finalHeaders, trimmedColumns, validRowCount, interpolatedCount } = parseDataContent(e.target.result);

        setHeaders(finalHeaders);
        setParsedFileResult(trimmedColumns);

        const initialColIndex = trimmedColumns.length > 1 ? 1 : 0;
        setSelectedColumnIndex(initialColIndex);
        setAppliedBaseline(null);
        
        // 載入檔案時自動配對
        autoSelectMuscle(finalHeaders[initialColIndex] || '');
        
        processEMG(trimmedColumns[initialColIndex]);

        if (interpolatedCount > 0) {
          setToastMessage(`⚠️ 偵測到 ${interpolatedCount} 筆遺失數據，已自動線性插值修復！`);
          setTimeout(() => setToastMessage(null), 4000);
        }
      } catch (err) {
        console.error(err);
        setErrorMessage(`檔案解析失敗: ${err.message}`);
        setAnalysisResult(null);
      }
    };
    reader.readAsText(file);
  };

  const runAnalysis = (targetIndex = selectedColumnIndex) => {
    setAnalysisResult(null); 
    setErrorMessage(null);
    setChartKey(prev => prev + 1); 
    setIsManualBaselineMode(false);
    setManualBaseStart(null);
    setManualBaseEnd(null);
    setAppliedBaseline(null);

    setTimeout(() => {
      if (parsedFileResult && parsedFileResult[targetIndex]) {
        processEMG(parsedFileResult[targetIndex]);
      } else {
        setErrorMessage("請先載入檔案或選擇正確的通道！");
      }
    }, 50); 
  };

  const handleColumnChange = (e) => {
    const newIdx = Number(e.target.value);
    setSelectedColumnIndex(newIdx);
    
    // 切換通道時自動配對目標肌肉
    autoSelectMuscle(headers[newIdx] || '');
    
    runAnalysis(newIdx); 
  };

  const processEMG = (data, customBaseline = null) => {
    if (!data || data.length < 10) {
      setErrorMessage("該欄位數據點過少 (< 10)，無法進行 DSP 運算！");
      setAnalysisResult(null);
      return;
    }
    setErrorMessage(null);

    let rawData = data;
    if (notchFilter) {
      rawData = biquadFilter(rawData, 'notch', 60, samplingRate);
    }
    let currentBpHigh = ecgFilter ? Math.max(30, bpHigh) : bpHigh;

    const filtered = bandpassFilter(rawData, currentBpHigh, bpLow, samplingRate);
    const rectified = new Float64Array(filtered.length);
    for(let i = 0; i < filtered.length; i++) rectified[i] = Math.abs(filtered[i]);
    
    const rmsEnvelope = biquadFilter(rectified, 'lowpass', lpfCutoff, samplingRate);

    let baseStart = baselineStart;
    let baseEnd = baseStart + baselineLength;
    
    baseStart = Math.max(0, Math.min(baseStart, rmsEnvelope.length - 1));
    baseEnd = Math.max(baseStart + 1, Math.min(baseEnd, rmsEnvelope.length));

    if (customBaseline) {
      baseStart = Math.min(customBaseline.start, customBaseline.end);
      baseEnd = Math.max(customBaseline.start, customBaseline.end);
      baseStart = Math.max(0, baseStart);
      baseEnd = Math.min(rmsEnvelope.length, baseEnd);
      if (baseStart === baseEnd) baseEnd = Math.min(baseStart + 10, rmsEnvelope.length);
    }

    const baselinePoints = baseEnd - baseStart;
    let sum = 0;
    for(let i = baseStart; i < baseEnd; i++) sum += rmsEnvelope[i];
    const baselineMean = sum / (baselinePoints || 1);
    
    let sumSqDiff = 0;
    for(let i = baseStart; i < baseEnd; i++) sumSqDiff += Math.pow(rmsEnvelope[i] - baselineMean, 2);
    const baselineSD = Math.sqrt(sumSqDiff / (baselinePoints || 1));
    const threshold = baselineMean + sdMultiplier * baselineSD;

    let initialOnset = -1;
    let overThresholdCount = 0;
    for (let i = baseEnd; i < rmsEnvelope.length; i++) {
      if (rmsEnvelope[i] > threshold) {
        overThresholdCount++;
        if (overThresholdCount >= consecutiveSamples) { 
          initialOnset = i - consecutiveSamples + 1;
          break;
        }
      } else {
        overThresholdCount = 0; 
      }
    }
    if (initialOnset === -1) initialOnset = baseEnd;

    setOnsetSample(initialOnset);

    const chartData = [];
    const MAX_CHART_POINTS = 4000;
    const step = Math.max(1, Math.floor(data.length / MAX_CHART_POINTS)); 
    
    for (let i = 0; i < data.length; i += step) {
      chartData.push({
        sample: i,
        original: Math.round(data[i] * 10000) / 10000,
        processed: Math.round(rectified[i] * 10000) / 10000,
        rms: Math.round(rmsEnvelope[i] * 10000) / 10000,
      });
    }

    setAnalysisResult({
      chartData,
      fullRms: rmsEnvelope,
      baselineMean: baselineMean,
      threshold: Math.round(threshold * 10000) / 10000
    });
  };

  const displayMetrics = useMemo(() => {
    if (!analysisResult || !analysisResult.fullRms) return null;
    
    const startAnalysis = onsetSample + Math.floor(samplingRate * analysisOffsetSec);
    const endAnalysis = startAnalysis + Math.floor(samplingRate * analysisDurationSec);
    
    const safeStart = Math.max(0, startAnalysis);
    const safeEnd = Math.max(safeStart, Math.min(endAnalysis, analysisResult.fullRms.length - 1));
    
    if (safeEnd <= safeStart) return null;
    
    const stableWindow = analysisResult.fullRms.slice(safeStart, safeEnd);
    if (stableWindow.length === 0) return null;

    const sumSq = stableWindow.reduce((acc, val) => acc + Math.pow(val, 2), 0);
    const finalRMS = Math.sqrt(sumSq / stableWindow.length);
    
    const meanEnv = stableWindow.reduce((a, b) => a + b, 0) / stableWindow.length;
    const peakRMS = Math.max(...stableWindow);
    const sdRMS = Math.sqrt(stableWindow.reduce((s, v) => s + Math.pow(v - meanEnv, 2), 0) / stableWindow.length);
    const cv = meanEnv > 0 ? (sdRMS / meanEnv) * 100 : 0;
    const snr = 20 * Math.log10(finalRMS / (analysisResult.baselineMean || 0.001));

    return {
      meanRMS: finalRMS.toFixed(4), 
      peakRMS: peakRMS.toFixed(4),
      cv: cv.toFixed(2),
      snr: snr.toFixed(2),
      startAnalysis: safeStart,
      endAnalysis: safeEnd
    };
  }, [analysisResult, onsetSample, samplingRate, analysisOffsetSec, analysisDurationSec]);

  const handleSaveMvicData = () => {
    if (!displayMetrics) return;
    
    if (mvicData[saveTarget].length >= 3) {
      setToastMessage(`❌ 【${saveTarget}】已達 3 次測試儲存上限！請先至資料庫刪除舊資料。`);
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }

    const valueToSave = parseFloat(displayMetrics.meanRMS);
    setMvicData(prev => ({
      ...prev,
      [saveTarget]: [...prev[saveTarget], valueToSave]
    }));
    
    setToastMessage(`✅ 成功儲存！目標肌肉：${saveTarget}，數值：${valueToSave} mV`);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // 將 MVIC 的 MouseDown 與 MouseMove 拔除依賴，避免觸發 Recharts 不斷重新註冊事件
  const handleMouseDown = useCallback((e) => {
    if (e) {
      const clickX = e.activeLabel !== undefined ? e.activeLabel : (e.activePayload?.[0]?.payload?.sample);
      if (clickX !== undefined && clickX !== null) {
        if (isManualBaselineMode) {
          setManualBaseStart(clickX);
          setManualBaseEnd(clickX);
          setIsSelectingBase(true);
        } else {
          // 極大化容錯體驗：只要不是手動框選模式，在圖表上任意處點擊就會直接把線吸附過去並開始拖曳！
          setOnsetSample(Math.max(0, clickX));
          setIsDragging(true);
        }
      }
    }
  }, [isManualBaselineMode]); 

  const handleChartMouseMove = useCallback((state) => {
    if (!isDragging && !(isManualBaselineMode && isSelectingBase)) return;
    if (state) {
      const currentX = state.activeLabel !== undefined ? state.activeLabel : (state.activePayload?.[0]?.payload?.sample);
      if (currentX !== undefined && currentX !== null) {
        if (isManualBaselineMode && isSelectingBase) {
          setManualBaseEnd(currentX);
        } else if (isDragging) {
          setOnsetSample(Math.max(0, currentX));
        }
      }
    }
  }, [isDragging, isManualBaselineMode, isSelectingBase]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setIsSelectingBase(false);
  }, []);

  return (
    <div className="min-h-screen bg-[#f1f5f9] p-6 font-sans text-slate-800 animate-in fade-in duration-500 relative" onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
      
      {toastMessage && (
        <div className="fixed top-8 left-1/2 transform -translate-x-1/2 z-50 bg-slate-800 text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 animate-in slide-in-from-top-4 duration-300">
          <span className="font-bold text-sm">{toastMessage}</span>
        </div>
      )}

      <header className="max-w-7xl mx-auto flex flex-col xl:flex-row justify-between items-start xl:items-center bg-white p-6 rounded-3xl shadow-sm border border-slate-100 mb-6 gap-4">
        <div className="flex items-center gap-4 shrink-0">
          <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500 hover:text-slate-800">
            <ArrowLeft size={24} />
          </button>
          <div className="bg-indigo-600 p-3 rounded-2xl shadow-lg">
            <Activity className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">MVIC 基準分析</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded text-[10px] font-bold">
                受測者: {activeSubjectId}
              </span>
              <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">Dual-Chart Signal Processing Engine</p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto">
          <div className="flex items-center bg-indigo-50 border border-indigo-100 px-3 py-1.5 rounded-xl shadow-sm">
            <span className="text-xs font-bold text-indigo-600 mr-2 shrink-0">分析通道:</span>
            <select 
              value={selectedColumnIndex} 
              onChange={handleColumnChange}
              disabled={headers.length === 0}
              className="w-40 bg-white text-sm font-bold text-indigo-800 focus:outline-none border border-indigo-200 rounded-lg px-2 py-1 cursor-pointer truncate"
            >
              {headers.length === 0 ? (
                <option value={0}>請先載入檔案</option>
              ) : (
                headers.map((h, i) => (
                  <option key={i} value={i}>{h}</option>
                ))
              )}
            </select>
            <button
              onClick={() => runAnalysis(selectedColumnIndex)}
              className="ml-3 shrink-0 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1 rounded-lg text-xs font-bold transition-all shadow-sm active:scale-95"
              title="套用參數重新分析"
            >
              分析
            </button>
          </div>

          <div className="flex items-center bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl hidden md:flex">
            <span className="text-xs font-semibold text-slate-500 mr-2 shrink-0">Bandpass:</span>
            <input 
              type="number" 
              value={bpHigh} 
              onChange={(e) => setBpHigh(Number(e.target.value))}
              className="w-10 bg-transparent text-sm font-bold text-indigo-600 focus:outline-none text-center"
              title="高通頻率 (Hz)"
            />
            <span className="text-xs text-slate-400 mx-1">-</span>
            <input 
              type="number" 
              value={bpLow} 
              onChange={(e) => setBpLow(Number(e.target.value))}
              className="w-10 bg-transparent text-sm font-bold text-indigo-600 focus:outline-none text-center"
              title="低通頻率 (Hz)"
            />
            <span className="text-xs text-slate-400 ml-1">Hz</span>
        </div>

        <div className="flex items-center bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl hidden md:flex gap-3">
          <label className="flex items-center gap-1 text-[10px] font-semibold text-slate-600 cursor-pointer" title="濾除 60Hz 市電雜訊">
            <input type="checkbox" checked={notchFilter} onChange={e=>setNotchFilter(e.target.checked)} className="accent-indigo-600"/> 60Hz 陷波
          </label>
          <label className="flex items-center gap-1 text-[10px] font-semibold text-slate-600 cursor-pointer" title="動態提升 High-pass 至 30Hz 濾除心跳突波">
            <input type="checkbox" checked={ecgFilter} onChange={e=>setEcgFilter(e.target.checked)} className="accent-indigo-600"/> 抑制 ECG
          </label>
        </div>

        <div className="flex items-center bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl hidden md:flex">
          <span className="text-xs font-semibold text-slate-500 mr-2 shrink-0">二次濾波(LPF):</span>
          <input 
            type="number" 
            value={lpfCutoff} 
            onChange={(e) => setLpfCutoff(Number(e.target.value))}
            className="w-10 bg-transparent text-sm font-bold text-indigo-600 focus:outline-none text-center"
            title="取代原本RMS，等同於LabVIEW的翻正後二次濾波"
          />
          <span className="text-xs text-slate-400 ml-1">Hz</span>
        </div>

        <div className="flex items-center bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl hidden md:flex">
          <span className="text-xs font-semibold text-slate-500 mr-2 shrink-0">採樣率:</span>
            <input 
              type="number" 
              value={samplingRate} 
              onChange={(e) => setSamplingRate(parseInt(e.target.value))}
              className="w-14 bg-transparent text-sm font-bold text-indigo-600 focus:outline-none"
            />
          </div>
          
          <div className="flex items-center bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl hidden md:flex">
            <span className="text-xs font-semibold text-slate-500 mr-2 shrink-0">延遲(s):</span>
            <input 
              type="number" 
              step="0.5"
              value={analysisOffsetSec} 
              onChange={(e) => setAnalysisOffsetSec(parseFloat(e.target.value) || 0)}
              className="w-10 bg-transparent text-sm font-bold text-indigo-600 focus:outline-none"
            />
          </div>

          <div className="flex items-center bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl hidden md:flex">
            <span className="text-xs font-semibold text-slate-500 mr-2 shrink-0">時長(s):</span>
            <input 
              type="number" 
              step="0.5"
              value={analysisDurationSec} 
              onChange={(e) => setAnalysisDurationSec(parseFloat(e.target.value) || 0)}
              className="w-10 bg-transparent text-sm font-bold text-indigo-600 focus:outline-none"
            />
          </div>

          <label className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-2xl transition-all shadow-md cursor-pointer text-sm font-bold shrink-0 xl:ml-auto">
            <Upload size={18} /> 載入數據
            <input type="file" className="hidden" accept=".csv,.txt" onChange={handleFileUpload} />
          </label>
        </div>
      </header>

      <main className="max-w-7xl mx-auto space-y-6">

        {/* 通道對應提示 */}
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 shadow-sm mb-4">
          <h4 className="text-xs font-bold text-slate-700 mb-2 flex items-center gap-1"><Info size={14}/> 肌肉通道對應參考 (Channel Mapping)</h4>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[10px] font-bold text-slate-600">
            {GLOBAL_EMG_MAPPINGS.map(m => (
              <div key={m.key} className={`bg-white px-2 py-1.5 rounded border ${m.side === 'Right' ? 'border-indigo-200' : 'border-emerald-200'} shadow-sm flex justify-between`}>
                <span>{m.ch}</span>
                <span className={m.side === 'Right' ? 'text-indigo-600' : 'text-emerald-600'}>{m.key}</span>
              </div>
            ))}
          </div>
          <p className="text-[9px] text-slate-400 mt-2 italic">※ R (右側) 以紫色標示；L (左側) 以綠色標示。系統將自動辨識通道標題配對目標肌肉。</p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <MetricCard title={`中間 ${analysisDurationSec}s 訊號 RMS 值`} value={displayMetrics?.meanRMS || '--'} unit="mV" icon={<BarChart className="text-blue-500" />} />
          <MetricCard title="分析區間峰值 (Peak Envelope)" value={displayMetrics?.peakRMS || '--'} unit="mV" icon={<Activity className="text-rose-500" />} />
          <MetricCard title="變異係數 (CV)" value={displayMetrics ? `${displayMetrics.cv}%` : '--'} unit="" icon={<ShieldCheck className={(displayMetrics && parseFloat(displayMetrics.cv) > 15) ? "text-amber-500" : "text-emerald-500"} />} />
          <MetricCard title="訊雜比 (SNR)" value={displayMetrics ? `${displayMetrics.snr}` : '--'} unit="dB" icon={<Info className="text-indigo-500" />} />
        </div>

        {analysisResult && displayMetrics && (
          <div className="bg-emerald-50 border border-emerald-200 p-5 rounded-3xl flex flex-wrap items-center justify-between gap-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="bg-emerald-100 p-2 rounded-xl text-emerald-600">
                <Save size={20} />
              </div>
              <div>
                <h3 className="font-bold text-emerald-800">儲存分析結果</h3>
                <p className="text-xs text-emerald-600 font-medium">將當前的區間 RMS 數值寫入歷史資料庫</p>
              </div>
            </div>
            
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-bold text-emerald-700">目標肌肉:</span>
              <select
                value={saveTarget}
                onChange={e => setSaveTarget(e.target.value)}
                className="px-4 py-2 rounded-xl border border-emerald-300 bg-white font-bold text-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
              >
                {MUSCLE_LIST.map(m => (
                  <option key={m} value={m}>{m} (已存 {mvicData[m].length}/3 次)</option>
                ))}
              </select>
              <button
                onClick={handleSaveMvicData}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-xl font-bold transition-colors shadow-sm active:scale-95 flex items-center gap-2"
              >
                寫入資料庫
              </button>
            </div>
          </div>
        )}

        {analysisResult && displayMetrics && (
          <div className="flex flex-col sm:flex-row items-center justify-between bg-indigo-50/80 px-5 py-3 rounded-2xl border border-indigo-100 shadow-sm mt-2">
            <span className="text-sm font-bold text-indigo-800 flex items-center gap-2">
              <Crosshair size={16} /> 
              基準點定位與分析區間
            </span>
            <div className="flex items-center gap-4 text-xs font-bold text-indigo-600 mt-2 sm:mt-0">
              <span className="flex items-center gap-1">
                啟動閥值起點: <span className="text-sm bg-white px-2 py-0.5 rounded shadow-sm">{onsetSample}</span>
              </span>
              <span className="text-indigo-300">|</span>
              <span className="flex items-center gap-1 text-slate-600">
                動態分析區間 (+{analysisOffsetSec}s ~ +{analysisOffsetSec + analysisDurationSec}s): 
                <span className="font-mono bg-slate-100 px-2 py-0.5 rounded shadow-sm border border-slate-200">
                  {displayMetrics.startAnalysis} ~ {displayMetrics.endAnalysis}
                </span>
              </span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
          
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
            <div className="flex items-center justify-between mb-2 h-8 overflow-hidden">
              <h3 className="text-md font-bold text-slate-700 flex items-center gap-2 flex-1 min-w-0 whitespace-nowrap overflow-hidden text-ellipsis">
                <Waves size={18} className="text-slate-400 shrink-0" />
                <span className="truncate">(1) 原始未處理信號 {headers.length > 0 ? `- ${headers[selectedColumnIndex]}` : ''}</span>
              </h3>
              <div className="text-[11px] font-bold text-slate-400 w-[150px] text-right shrink-0 ml-2">
                游標懸停可查看數值
              </div>
            </div>
            
            {/* 強制加入 select-none 避免瀏覽器選取反白干擾拖曳，且設定 isAnimationActive={false} 提升效能 */}
            <div className="h-[320px] w-full select-none" draggable={false} style={{ cursor: isManualBaselineMode ? 'crosshair' : (isDragging ? 'ew-resize' : 'default') }}>
              {analysisResult ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={analysisResult.chartData} onMouseDown={handleMouseDown} onMouseMove={handleChartMouseMove} onMouseUp={handleMouseUp} syncId={`emgSync-${chartKey}`}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="sample" type="number" domain={['dataMin', 'dataMax']} hide />
                    <YAxis axisLine={false} tick={{fontSize: 10}} />
                    <Tooltip content={<SimpleTooltip dataKey="original" label="原始" color="#94a3b8" />} />
                    
                    {displayMetrics && (
                      <ReferenceArea x1={displayMetrics.startAnalysis} x2={displayMetrics.endAnalysis} fill="#4f46e5" fillOpacity={0.05} />
                    )}
                    {isManualBaselineMode && manualBaseStart !== null && manualBaseEnd !== null && (
                      <ReferenceArea x1={manualBaseStart} x2={manualBaseEnd} fill="#f59e0b" fillOpacity={0.3} />
                    )}
                    <ReferenceLine x={onsetSample} stroke="#3b82f6" strokeWidth={2.5} style={{ cursor: 'ew-resize', pointerEvents: 'none' }} label={{ value: `啟動點`, position: 'insideTopLeft', fill: '#3b82f6', fontSize: 11, fontWeight: 'bold' }} />

                    <Line type="monotone" dataKey="original" stroke="#94a3b8" strokeWidth={1} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <Placeholder error={errorMessage} />}
            </div>
          </div>

          <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
            <div className="flex items-center justify-between mb-2 h-8 overflow-hidden">
              <h3 className="text-md font-bold text-slate-700 flex items-center gap-2 flex-1 min-w-0 whitespace-nowrap overflow-hidden text-ellipsis">
                <Layers size={18} className="text-indigo-600 shrink-0" />
                <span className="truncate">(2) 濾波整流與 LPF 包絡線</span>
              </h3>
              <div className="text-[11px] font-bold text-indigo-400 w-[150px] text-right shrink-0 ml-2">
                游標懸停可查看數值
              </div>
            </div>

            <div className="h-[320px] w-full select-none" draggable={false} style={{ cursor: isManualBaselineMode ? 'crosshair' : (isDragging ? 'ew-resize' : 'default') }}>
              {analysisResult ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={analysisResult.chartData} onMouseDown={handleMouseDown} onMouseMove={handleChartMouseMove} onMouseUp={handleMouseUp} syncId={`emgSync-${chartKey}`}>
                    <defs>
                      <linearGradient id="colorProc" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.1}/>
                        <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="sample" type="number" domain={['dataMin', 'dataMax']} tick={{fontSize: 10}} />
                    <YAxis axisLine={false} tick={{fontSize: 10}} />
                    <Tooltip content={<SimpleTooltip dataKey="rms" label="Env" color="#4f46e5" />} />
                    
                    {displayMetrics && (
                      <ReferenceArea x1={displayMetrics.startAnalysis} x2={displayMetrics.endAnalysis} fill="#4f46e5" fillOpacity={0.08} />
                    )}
                    {isManualBaselineMode && manualBaseStart !== null && manualBaseEnd !== null && (
                      <ReferenceArea x1={manualBaseStart} x2={manualBaseEnd} fill="#f59e0b" fillOpacity={0.3} />
                    )}
                    <ReferenceLine x={onsetSample} stroke="#3b82f6" strokeWidth={2.5} style={{ cursor: 'ew-resize', pointerEvents: 'none' }} label={{ value: `啟動點`, position: 'insideTopLeft', fill: '#3b82f6', fontSize: 11, fontWeight: 'bold' }} />
                    <ReferenceLine y={analysisResult.threshold} stroke="#ef4444" strokeDasharray="3 3" />

                    <Area type="monotone" dataKey="processed" stroke="#e2e8f0" fill="url(#colorProc)" dot={false} strokeWidth={1} isAnimationActive={false} />
                    <Line type="monotone" dataKey="rms" stroke="#4f46e5" strokeWidth={2} dot={false} isAnimationActive={false} />
                    
                    <Brush dataKey="sample" height={30} stroke="#94a3b8" fill="#f8fafc" travellerWidth={10} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : <Placeholder error={errorMessage} />}
            </div>
          </div>
        </div>

        {analysisResult && (
          <div className="bg-amber-50 border border-amber-200 p-5 rounded-3xl flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4 shadow-sm transition-all duration-300 mt-6">
            <div className="flex items-center gap-3">
              <div className="bg-amber-100 p-2 rounded-xl text-amber-600">
                <Settings2 size={20} />
              </div>
              <div>
                <h3 className="font-bold text-amber-800">進階定位設定 (手動補救與對齊 LabVIEW)</h3>
                <p className="text-xs text-amber-600 font-medium">調整 Baseline 擷取範圍與啟動判定條件，以貼齊 LabVIEW 參數</p>
              </div>
            </div>
            
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-amber-200 shadow-sm">
                 <span className="text-xs font-bold text-amber-700">Baseline 起點:</span>
                 <input type="number" value={baselineStart} onChange={e => setBaselineStart(Number(e.target.value))} className="w-14 text-center text-sm font-black text-amber-600 focus:outline-none" />
                 <span className="text-xs font-bold text-amber-700">長度:</span>
                 <input type="number" value={baselineLength} onChange={e => setBaselineLength(Number(e.target.value))} className="w-16 text-center text-sm font-black text-amber-600 focus:outline-none" />
              </div>
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-amber-200 shadow-sm">
                 <span className="text-xs font-bold text-amber-700">閥值: Mean +</span>
                 <input type="number" step="0.5" value={sdMultiplier} onChange={e => setSdMultiplier(Number(e.target.value))} className="w-10 text-center text-sm font-black text-amber-600 focus:outline-none" />
                 <span className="text-xs font-bold text-amber-700">× SD</span>
              </div>
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-amber-200 shadow-sm">
                 <span className="text-xs font-bold text-amber-700">需連續:</span>
                 <input type="number" value={consecutiveSamples} onChange={e => setConsecutiveSamples(Number(e.target.value))} className="w-14 text-center text-sm font-black text-amber-600 focus:outline-none" />
                 <span className="text-xs font-bold text-amber-700">筆</span>
              </div>
              
              <button 
                onClick={() => {
                  processEMG(parsedFileResult[selectedColumnIndex], appliedBaseline);
                  setToastMessage("✅ 參數已套用！圖表已重新尋找起點。");
                  setTimeout(() => setToastMessage(null), 3000);
                }}
                className="bg-amber-100 hover:bg-amber-200 text-amber-700 px-4 py-2 rounded-xl font-bold transition-colors shadow-sm active:scale-95 text-xs"
              >
                套用參數
              </button>

              {!isManualBaselineMode ? (
                <button
                  onClick={() => {
                    setIsManualBaselineMode(true);
                    setManualBaseStart(null);
                    setManualBaseEnd(null);
                  }}
                  className="bg-amber-500 hover:bg-amber-600 text-white px-5 py-2 rounded-xl font-bold transition-colors shadow-sm active:scale-95 text-sm xl:ml-2"
                >
                  手動框選新基準
                </button>
              ) : (
                <div className="flex items-center gap-3 bg-white p-1.5 rounded-2xl border border-amber-400 shadow-md animate-in zoom-in-95 duration-200 xl:ml-2">
                  <span className="text-xs font-bold text-amber-700 px-3">
                    {manualBaseStart !== null && manualBaseEnd !== null
                      ? `已選區間: ${Math.min(manualBaseStart, manualBaseEnd)} ~ ${Math.max(manualBaseStart, manualBaseEnd)}`
                      : '請在圖表拖曳...'}
                  </span>
                  <button
                    onClick={() => {
                      setIsManualBaselineMode(false);
                      setManualBaseStart(null);
                      setManualBaseEnd(null);
                    }}
                    className="bg-slate-100 hover:bg-slate-200 text-slate-600 px-4 py-1.5 rounded-xl font-bold transition-colors text-xs"
                  >
                    取消
                  </button>
                  <button
                    onClick={() => {
                      if (manualBaseStart !== null && manualBaseEnd !== null) {
                        const newBaseline = { start: manualBaseStart, end: manualBaseEnd };
                        setAppliedBaseline(newBaseline);
                        processEMG(parsedFileResult[selectedColumnIndex], newBaseline);
                        setIsManualBaselineMode(false);
                        setToastMessage("✅ 基準重設成功！圖表已重新計算閥值並尋找起點。");
                        setTimeout(() => setToastMessage(null), 3000);
                      } else {
                        setToastMessage("⚠️ 請先在圖表上拖曳選取基準範圍！");
                        setTimeout(() => setToastMessage(null), 3000);
                      }
                    }}
                    className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-1.5 rounded-xl font-bold transition-colors shadow-sm active:scale-95 text-xs"
                  >
                    套用選區並分析
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {parsedFileResult && (
          <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6 overflow-hidden mt-6">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                <Layers size={18} className="text-slate-400" />
                原始資料預覽（為維持效能，僅顯示前 1000 列）
              </h4>
              <span className="text-[11px] font-bold text-slate-400 bg-slate-50 px-2 py-1 rounded-lg">
                共 {headers.length} 欄，顯示前 {Math.min(1000, parsedFileResult[0].length)} 筆
              </span>
            </div>
            
            <div className="overflow-auto max-h-[400px] w-full border border-slate-200 rounded-xl relative scroll-smooth bg-slate-50/30 shadow-inner">
              <table className="min-w-max w-full text-xs text-slate-700 bg-white">
                <thead>
                  <tr>
                    <th className="sticky top-0 left-0 z-30 px-4 py-3 text-center font-bold text-slate-600 bg-slate-200 border-b border-r border-slate-300 shadow-[2px_2px_5px_rgba(0,0,0,0.05)] whitespace-nowrap">
                      Index
                    </th>
                    {headers.map((h, idx) => (
                      <th key={idx} className={`sticky top-0 z-20 px-4 py-3 text-left font-bold whitespace-nowrap border-b border-slate-300 shadow-sm ${idx === selectedColumnIndex ? 'text-indigo-700 bg-indigo-100' : 'bg-slate-100'}`}>
                        {h} {idx === selectedColumnIndex && '✓'}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {Array.from({ length: Math.min(1000, parsedFileResult[0].length) }).map((_, rIdx) => (
                    <tr key={rIdx} className="hover:bg-slate-50 transition-colors">
                      <td className="sticky left-0 z-10 px-4 py-1.5 font-mono text-slate-500 text-center bg-slate-50 border-r border-slate-200 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">
                        {rIdx + 1}
                      </td>
                      {parsedFileResult.map((col, cIdx) => (
                        <td key={cIdx} className={`px-4 py-1.5 font-mono whitespace-nowrap ${cIdx === selectedColumnIndex ? 'bg-indigo-50/20 text-indigo-700 font-bold' : ''}`}>
                          {col[rIdx]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="bg-slate-900 rounded-3xl p-8 text-white grid grid-cols-1 md:grid-cols-2 gap-8 mt-6">
          <div>
            <h4 className="text-indigo-400 font-bold text-xs uppercase tracking-widest mb-4">分析演算法說明 (與 LabVIEW 同步)</h4>
            <div className="space-y-3 text-sm text-slate-400">
              <p>• <b>處理流程</b>：原始信號 → 2階 Butterworth 帶通濾波 (Bandpass) → 全波整流 (絕對值) → 2階 Butterworth 低通濾波平滑 (LPF, 二次濾波)。</p>
              <p>• <b>自動定位</b>：取前 2000 個 Sample (或自訂區間) 作為靜態基準，以 $Mean + {sdMultiplier} \times SD$ 為啟動閥值，且需<b>連續 {consecutiveSamples} 筆</b>超過閥值才判定為啟動。圖表上的藍色粗線代表此起點。</p>
              <p>• <b>數值計算</b>：提取目標秒數區間之數據，並使用與 LabVIEW 完全相同的公式計算其<b>均方根 (Root Mean Square, RMS)</b>。</p>
            </div>
          </div>
          <div>
            <h4 className="text-indigo-400 font-bold text-xs uppercase tracking-widest mb-4">動態參數對應 (LabVIEW 相容)</h4>
            <p className="text-sm text-slate-400 mb-4">已完整移植 LabVIEW 設定參數與 Butterworth DSP。系統會根據藍色起點線，加上上方設定的「延遲分析秒數」作為真正分析的起始點，並擷取「分析時長」作為穩定期計算基準。您可以拖曳起點線來校正整段區域。</p>
            <div className="flex gap-4">
              <div className="flex items-center gap-2 text-[10px] text-slate-400">
                <div className="w-3 h-1 bg-slate-400"></div> 原始數值
              </div>
              <div className="flex items-center gap-2 text-[10px] text-indigo-400 font-bold">
                <div className="w-3 h-1 bg-indigo-500"></div> LPF 包絡線
              </div>
              <div className="flex items-center gap-2 text-[10px] text-indigo-400 font-bold">
                <div className="w-3 h-3 bg-indigo-500 opacity-20"></div> 動態分析區間
              </div>
            </div>
          </div>
        </div>

      </main>
    </div>
  );
};

// --- 擴充模組 Placeholder ---
const ModulePlaceholder = ({ title, icon, description, onBack }) => (
  <div className="min-h-screen bg-[#f1f5f9] p-6 font-sans text-slate-800 animate-in fade-in duration-500">
    <header className="max-w-7xl mx-auto flex items-center gap-4 bg-white p-6 rounded-3xl shadow-sm border border-slate-100 mb-6">
      <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500"><ArrowLeft size={24} /></button>
      <div className="bg-blue-500 p-3 rounded-2xl shadow-lg text-white">{icon}</div>
      <div><h1 className="text-xl font-bold text-slate-900">{title}</h1><p className="text-xs text-slate-400 font-medium uppercase mt-1 tracking-wider">{description}</p></div>
    </header>
    <main className="max-w-7xl mx-auto bg-white h-[60vh] rounded-3xl shadow-sm border border-slate-100 flex flex-col items-center justify-center text-slate-400">
      <div className="bg-slate-50 p-8 rounded-full mb-4">{icon}</div><h2 className="text-xl font-bold text-slate-600 mb-2">模組建置中</h2><p className="text-sm">此為預留擴充區塊，未來可匯入專屬的 {title} 演算法。</p>
    </main>
  </div>
);

// --- 所有個案總覽 (Global Overview) 模組 ---
const GlobalDatabaseOverview = ({ subjects, setSubjects, activeSubjectId, setActiveSubjectId, onBack }) => {
  const getMvicProgress = (mvicData) => {
    let full = 0;
    let partial = 0;
    MUSCLE_LIST.forEach(m => {
      if (mvicData[m]?.length === 3) full++;
      else if (mvicData[m]?.length > 0) partial++;
    });
    return { full, partial, total: MUSCLE_LIST.length };
  };

  const getTaskCount = (data) => Object.keys(data).filter(k => data[k] && data[k].length > 0).length;

  const handleDelete = (id) => {
    if (Object.keys(subjects).length <= 1) {
      alert("至少必須保留一位受測者！");
      return;
    }
    if (window.confirm(`確定要刪除「${id}」的所有資料嗎？\n\n此操作無法復原！`)) {
      const newSubjects = { ...subjects };
      delete newSubjects[id];
      setSubjects(newSubjects);
      // 如果刪除的是當前選擇的受測者，則自動切換至清單中的第一位
      if (activeSubjectId === id) {
        setActiveSubjectId(Object.keys(newSubjects)[0]);
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#f1f5f9] p-6 font-sans text-slate-800 animate-in fade-in duration-500 relative">
      <header className="max-w-7xl mx-auto flex items-center gap-4 bg-white p-6 rounded-3xl shadow-sm border border-slate-100 mb-6">
        <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500 hover:text-slate-800">
          <ArrowLeft size={24} />
        </button>
        <div className="bg-purple-500 p-3 rounded-2xl shadow-lg text-white">
          <Users className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">所有個案數據總覽</h1>
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mt-1">Global Subject Overview</p>
        </div>
      </header>

      <main className="max-w-7xl mx-auto bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold text-sm">
              <tr>
                <th className="p-5">受測者編號 (Subject ID)</th>
                <th className="p-5">MVIC 完成度</th>
                <th className="p-5">Lifting 任務資料</th>
                <th className="p-5">其他動態任務</th>
                <th className="p-5 text-center">操作與管理</th>
              </tr>
            </thead>
            <tbody className="text-sm divide-y divide-slate-100">
              {Object.entries(subjects).map(([id, data]) => {
                const isActive = id === activeSubjectId;
                const mvicProg = getMvicProgress(data.mvicData);
                const liftEmgCnt = getTaskCount(data.taskLiftEmgData);
                const liftKinCnt = getTaskCount(data.taskLiftAngleData);
                const otherTaskCnt = getTaskCount(data.taskOpenStringData) + getTaskCount(data.taskScaleData) + getTaskCount(data.taskMusicData);

                return (
                  <tr key={id} className={`hover:bg-slate-50/80 transition-colors ${isActive ? 'bg-indigo-50/40' : ''}`}>
                    <td className="p-5">
                      <div className="flex items-center gap-3">
                        {isActive ? <CheckCircle size={18} className="text-indigo-600" /> : <div className="w-4 h-4 rounded-full border-2 border-slate-300"></div>}
                        <span className={`font-bold ${isActive ? 'text-indigo-800 text-base' : 'text-slate-700'}`}>{id}</span>
                        {isActive && <span className="bg-indigo-100 text-indigo-700 text-[10px] px-2 py-0.5 rounded font-bold">目前使用中</span>}
                      </div>
                    </td>
                    <td className="p-5">
                       <div className="flex flex-col gap-1">
                         <div className="flex items-center gap-2">
                           <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden w-24">
                              <div className={`h-full ${mvicProg.full === mvicProg.total ? 'bg-emerald-500' : 'bg-indigo-400'}`} style={{ width: `${(mvicProg.full / mvicProg.total) * 100}%` }}></div>
                           </div>
                           <span className={`text-xs font-bold ${mvicProg.full === mvicProg.total ? 'text-emerald-600' : 'text-slate-600'}`}>
                             {mvicProg.full}/{mvicProg.total} 肌肉
                           </span>
                         </div>
                         {mvicProg.partial > 0 && <span className="text-[10px] text-amber-600 font-bold">({mvicProg.partial} 肌肉僅部分完成)</span>}
                       </div>
                    </td>
                    <td className="p-5">
                      <div className="flex flex-col gap-1 text-xs">
                        <span className={liftEmgCnt > 0 ? 'text-indigo-600 font-bold' : 'text-slate-400'}>EMG: {liftEmgCnt} 通道</span>
                        <span className={liftKinCnt > 0 ? 'text-emerald-600 font-bold' : 'text-slate-400'}>Kinematics: {liftKinCnt} 關節</span>
                      </div>
                    </td>
                    <td className="p-5">
                       <span className={`text-xs font-bold px-2.5 py-1 rounded-lg ${otherTaskCnt > 0 ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-400'}`}>
                          共 {otherTaskCnt} 筆延伸任務
                       </span>
                    </td>
                    <td className="p-5">
                      <div className="flex items-center justify-center gap-2">
                        {!isActive && (
                          <button onClick={() => setActiveSubjectId(id)} className="px-3 py-1.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg text-xs font-bold transition-colors shadow-sm">
                            切換至此個案
                          </button>
                        )}
                        <button onClick={() => handleDelete(id)} className="p-2 text-rose-500 hover:bg-rose-100 rounded-lg transition-colors" title="刪除此受測者">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
};

// --- 主應用程式 (Router 與狀態共享層) ---
const getEmptySubjectData = () => ({
  mvicData: MUSCLE_LIST.reduce((acc, muscle) => ({ ...acc, [muscle]: [] }), {}),
  taskLiftEmgData: MUSCLE_LIST.reduce((acc, muscle) => ({ ...acc, [muscle]: [] }), {}),
  taskLiftAngleData: {},
  taskOpenStringData: MUSCLE_LIST.reduce((acc, muscle) => ({ ...acc, [muscle]: [] }), {}),
  taskScaleData: MUSCLE_LIST.reduce((acc, muscle) => ({ ...acc, [muscle]: [] }), {}),
  taskMusicData: MUSCLE_LIST.reduce((acc, muscle) => ({ ...acc, [muscle]: [] }), {})
});

const App = () => {
  const [currentView, setCurrentView] = useState('home');
  const [isExporting, setIsExporting] = useState(false);
  
  // 受測者狀態管理 (加入 localStorage 持久化機制)
  const [subjects, setSubjects] = useState(() => {
    try {
      const localData = localStorage.getItem('emgAppSubjects');
      if (localData) {
        const parsed = JSON.parse(localData);
        // 確保向下相容 (若未來有新增的資料結構可以自動補上)
        const safeParsed = {};
        Object.keys(parsed).forEach(key => {
          safeParsed[key] = { ...getEmptySubjectData(), ...parsed[key] };
        });
        return safeParsed;
      }
    } catch (e) {
      console.error("載入本地資料失敗", e);
    }
    return { 'Subject_01': getEmptySubjectData() };
  });

  const [activeSubjectId, setActiveSubjectId] = useState(() => {
    try {
      const localId = localStorage.getItem('emgAppActiveSubject');
      return localId || 'Subject_01';
    } catch (e) {
      return 'Subject_01';
    }
  });

  const [newSubjectName, setNewSubjectName] = useState('');

  // 監聽並自動儲存至 localStorage
  useEffect(() => {
    try {
      localStorage.setItem('emgAppSubjects', JSON.stringify(subjects));
    } catch (err) {
      console.error("儲存本地資料失敗 (可能資料量過大):", err);
    }
  }, [subjects]);

  useEffect(() => {
    try {
      localStorage.setItem('emgAppActiveSubject', activeSubjectId);
    } catch (err) {
      console.error("儲存本地資料失敗:", err);
    }
  }, [activeSubjectId]);

  const handleAddSubject = () => {
    if (!newSubjectName.trim()) return;
    if (subjects[newSubjectName]) {
      alert("此受測者編號已存在！");
      return;
    }
    setSubjects(prev => ({
      ...prev,
      [newSubjectName.trim()]: getEmptySubjectData()
    }));
    setActiveSubjectId(newSubjectName.trim());
    setNewSubjectName('');
  };

  // 生成狀態更新器 (確保更新寫入當前 activeSubjectId)
  const createSetter = useCallback((dataKey) => (newValueOrUpdater) => {
    setSubjects(prevSubjects => {
      const currentSubjectData = prevSubjects[activeSubjectId][dataKey];
      const updatedData = typeof newValueOrUpdater === 'function' 
        ? newValueOrUpdater(currentSubjectData) 
        : newValueOrUpdater;
      return {
        ...prevSubjects,
        [activeSubjectId]: {
          ...prevSubjects[activeSubjectId],
          [dataKey]: updatedData
        }
      };
    });
  }, [activeSubjectId]);

  // 動態綁定當前受測者的資料與更新函數
  const mvicData = subjects[activeSubjectId].mvicData;
  const setMvicData = createSetter('mvicData');
  
  const taskLiftEmgData = subjects[activeSubjectId].taskLiftEmgData;
  const setTaskLiftEmgData = createSetter('taskLiftEmgData');
  
  const taskLiftAngleData = subjects[activeSubjectId].taskLiftAngleData;
  const setTaskLiftAngleData = createSetter('taskLiftAngleData');
  
  const taskOpenStringData = subjects[activeSubjectId].taskOpenStringData;
  const setTaskOpenStringData = createSetter('taskOpenStringData');
  
  const taskScaleData = subjects[activeSubjectId].taskScaleData;
  const setTaskScaleData = createSetter('taskScaleData');
  
  const taskMusicData = subjects[activeSubjectId].taskMusicData;
  const setTaskMusicData = createSetter('taskMusicData');

  const handleExportExcel = async () => {
    try {
      setIsExporting(true);
      const XLSX = await loadXLSX();
      const wb = XLSX.utils.book_new();

      // MVIC 匯出 (跨所有受測者)
      const mvicRows = [];
      Object.entries(subjects).forEach(([subjectId, subjData]) => {
        MUSCLE_LIST.forEach(muscle => {
          const trials = subjData.mvicData[muscle] || [];
          if (trials.length === 0) return; // 略過沒有資料的肌肉
          const mean = calcMean(trials);
          const sd = calcSD(trials, mean);
          mvicRows.push({
            Subject: subjectId,
            Muscle: muscle,
            Trial_1: trials[0] !== undefined ? trials[0] : '',
            Trial_2: trials[1] !== undefined ? trials[1] : '',
            Trial_3: trials[2] !== undefined ? trials[2] : '',
            Mean: trials.length > 0 ? mean : '',
            SD: trials.length > 1 ? sd : ''
          });
        });
      });
      if (mvicRows.length > 0) {
        const wsMvic = XLSX.utils.json_to_sheet(mvicRows);
        XLSX.utils.book_append_sheet(wb, wsMvic, "MVIC");
      }

      // Lifting EMG (跨所有受測者)
      const liftingEmgRows = [];
      Object.entries(subjects).forEach(([subjectId, subjData]) => {
        const dataObj = subjData.taskLiftEmgData;
        const savedKeys = Object.keys(dataObj).filter(k => dataObj[k].length > 0);
        if (savedKeys.length === 0) return;

        const phases = ['Up_30-60', 'Up_60-90', 'Up_90-120', 'Down_120-90', 'Down_90-60', 'Down_60-30'];
        savedKeys.forEach(key => {
          const trials = dataObj[key] || [];
          const mvicTrials = subjData.mvicData[key] || [];
          const mvicMeanVal = mvicTrials.length > 0 ? calcMean(mvicTrials) : null;
          const mvicMean = (mvicMeanVal !== null && mvicMeanVal > 0) ? mvicMeanVal : null;
          const row = { Subject: subjectId, Muscle: key };
          
          [0, 1, 2].forEach(tIdx => {
            const trial = trials[tIdx] || {};
            phases.forEach(phase => {
              const val = trial[phase];
              row[`T${tIdx+1}_${phase}_RMS`] = val !== undefined ? val : '';
              row[`T${tIdx+1}_${phase}_%MVIC`] = (val !== undefined && val !== '' && mvicMean !== null) 
                  ? ((val / mvicMean) * 100).toFixed(2) + '%'
                  : '';
            });
          });

          phases.forEach(phase => {
            const vals = trials.map(t => t[phase]).filter(v => v !== undefined && v !== '');
            const meanVal = vals.length > 0 ? calcMean(vals) : '';
            row[`Mean_${phase}_RMS`] = meanVal !== '' ? meanVal.toFixed(4) : '';
            row[`Mean_${phase}_%MVIC`] = (meanVal !== '' && mvicMean !== null) 
                ? ((meanVal / mvicMean) * 100).toFixed(2) + '%'
                : '';
          });
          liftingEmgRows.push(row);
        });
      });
      if (liftingEmgRows.length > 0) {
        const wsLiftingEmg = XLSX.utils.json_to_sheet(liftingEmgRows);
        XLSX.utils.book_append_sheet(wb, wsLiftingEmg, "Lifting_EMG");
      }

      // Lifting Angle (跨所有受測者)
      const liftingAngleRows = [];
      Object.entries(subjects).forEach(([subjectId, subjData]) => {
        const dataObj = subjData.taskLiftAngleData;
        const savedKeys = Object.keys(dataObj).filter(k => dataObj[k].length > 0);
        if (savedKeys.length === 0) return;

        const phases = ['Up_30', 'Up_60', 'Up_90', 'Down_90', 'Down_60', 'Down_30'];
        savedKeys.forEach(key => {
          const trials = dataObj[key] || [];
          const row = { Subject: subjectId, Channel: key };
          
          [0, 1, 2].forEach(tIdx => {
            const trial = trials[tIdx] || {};
            phases.forEach(phase => {
              row[`T${tIdx+1}_${phase}`] = trial[phase] !== undefined ? trial[phase] : '';
            });
          });

          phases.forEach(phase => {
            const vals = trials.map(t => t[phase]).filter(v => v !== undefined && v !== '');
            row[`Mean_${phase}`] = vals.length > 0 ? calcMean(vals).toFixed(4) : '';
          });
          liftingAngleRows.push(row);
        });
      });
      if (liftingAngleRows.length > 0) {
        const wsLiftingAngles = XLSX.utils.json_to_sheet(liftingAngleRows);
        XLSX.utils.book_append_sheet(wb, wsLiftingAngles, "Lifting_Angles");
      }

      // Summary (跨所有受測者)
      const summaryRows = [];
      Object.entries(subjects).forEach(([subjectId, subjData]) => {
        let hasAnyData = false; 
        const subjRows = MUSCLE_LIST.map(muscle => {
          const liftTrials = subjData.taskLiftEmgData[muscle] || [];
          const allLiftVals = [];
          liftTrials.forEach(t => {
             ['Up_30-60', 'Up_60-90', 'Up_90-120', 'Down_120-90', 'Down_90-60', 'Down_60-30'].forEach(p => { 
               if (t[p] !== undefined && t[p] !== '') allLiftVals.push(t[p]); 
             });
          });

          const mvicTrials = subjData.mvicData[muscle] || [];
          const mvicMeanVal = mvicTrials.length > 0 ? calcMean(mvicTrials) : null;
          const mvicMean = (mvicMeanVal !== null && mvicMeanVal > 0) ? mvicMeanVal : null;
          
          const liftMean = allLiftVals.length > 0 ? calcMean(allLiftVals).toFixed(4) : '';
          const liftMeanPct = (liftMean !== '' && mvicMean !== null) ? ((liftMean / mvicMean) * 100).toFixed(2) + '%' : '';
          
          const openStringVal = subjData.taskOpenStringData[muscle]?.[0] || '';
          const openStringPct = (openStringVal !== '' && mvicMean !== null) ? ((openStringVal / mvicMean) * 100).toFixed(2) + '%' : '';
          
          const scaleVal = subjData.taskScaleData[muscle]?.[0] || '';
          const scalePct = (scaleVal !== '' && mvicMean !== null) ? ((scaleVal / mvicMean) * 100).toFixed(2) + '%' : '';
          
          const musicVal = subjData.taskMusicData[muscle]?.[0] || '';
          const musicPct = (musicVal !== '' && mvicMean !== null) ? ((musicVal / mvicMean) * 100).toFixed(2) + '%' : '';
          
          if (mvicMean !== null || liftMean !== '' || openStringVal !== '' || scaleVal !== '' || musicVal !== '') hasAnyData = true;

          return {
            Subject: subjectId,
            Muscle: muscle,
            MVIC_Mean: mvicMean !== null ? mvicMean.toFixed(4) : '',
            Lift_Overall_Avg_RMS: liftMean,
            'Lift_Overall_%MVIC': liftMeanPct,
            OpenString_RMS: openStringVal,
            'OpenString_%MVIC': openStringPct,
            Scale_RMS: scaleVal,
            'Scale_%MVIC': scalePct,
            Music_RMS: musicVal,
            'Music_%MVIC': musicPct
          };
        });
        if (hasAnyData) summaryRows.push(...subjRows);
      });
      
      if (summaryRows.length > 0) {
        const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
        XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");
      }

      if (wb.SheetNames.length === 0) {
         alert("目前沒有任何數據可以匯出！");
         setIsExporting(false);
         return;
      }

      XLSX.writeFile(wb, "EMG_Research_Data_SPSS.xlsx");
    } catch (err) {
      alert("匯出失敗: " + err.message);
    } finally {
      setIsExporting(false);
    }
  };

  const renderHome = () => (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800 p-6 md:p-10 animate-in fade-in duration-500">
      <header className="max-w-6xl mx-auto mb-8 text-center md:text-left">
        <h1 className="text-4xl font-black text-slate-900 tracking-tight flex items-center justify-center md:justify-start gap-3">
          <Activity className="text-indigo-600" size={36} /> EMG 科研整合平台
        </h1>
        <p className="text-slate-500 mt-2 font-medium">Musculoskeletal & Biomechanics Laboratory Center</p>
      </header>

      <main className="max-w-6xl mx-auto space-y-12">
        {/* 受測者管理區塊 */}
        <section className="bg-white p-6 rounded-3xl border border-indigo-100 shadow-sm flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="bg-indigo-100 p-3 rounded-2xl text-indigo-600">
              <User size={24} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">受測者管理 (Subject Management)</h2>
              <p className="text-xs text-slate-500 mt-0.5">切換受測者後，所有分析與儲存將會獨立紀錄</p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto">
            <select 
              value={activeSubjectId} 
              onChange={(e) => setActiveSubjectId(e.target.value)} 
              className="w-full sm:w-auto px-4 py-2 border border-slate-200 bg-slate-50 rounded-xl font-bold text-indigo-800 outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer shadow-sm"
            >
              {Object.keys(subjects).map(id => <option key={id} value={id}>受測者: {id}</option>)}
            </select>
            <div className="flex items-center w-full sm:w-auto gap-2 bg-white p-1 rounded-xl border border-slate-200 shadow-sm focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-200 transition-all">
              <input 
                type="text" 
                value={newSubjectName} 
                onChange={e => setNewSubjectName(e.target.value)} 
                placeholder="輸入新編號..." 
                className="px-3 py-1.5 bg-transparent text-sm font-bold outline-none w-full sm:w-32" 
                onKeyDown={(e) => e.key === 'Enter' && handleAddSubject()}
              />
              <button onClick={handleAddSubject} className="bg-slate-800 hover:bg-slate-900 text-white px-3 py-1.5 rounded-lg text-sm font-bold transition-all flex items-center gap-1 shrink-0">
                <UserPlus size={16} /> 新增
              </button>
            </div>
            <button 
              onClick={() => {
                if(window.confirm('確定要清除所有受測者與歷史資料嗎？\n\n此操作將清空瀏覽器中的暫存資料庫且無法復原！')) {
                  localStorage.removeItem('emgAppSubjects');
                  localStorage.removeItem('emgAppActiveSubject');
                  setSubjects({ 'Subject_01': getEmptySubjectData() });
                  setActiveSubjectId('Subject_01');
                }
              }} 
              className="bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 p-2.5 rounded-xl text-sm font-bold transition-all shrink-0 shadow-sm"
              title="清除所有暫存資料庫"
            >
              <Trash2 size={18} />
            </button>
          </div>
        </section>

        <section>
          <div className="flex items-center gap-2 mb-6 border-b border-slate-200 pb-2"><Activity size={20} className="text-indigo-600" /><h2 className="text-xl font-bold text-slate-800">信號分析模組</h2></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <div onClick={() => setCurrentView('mvic')} className="bg-white p-6 rounded-3xl border border-slate-200 hover:border-indigo-400 hover:shadow-lg transition-all cursor-pointer group">
              <div className="bg-indigo-100 w-12 h-12 rounded-2xl flex items-center justify-center mb-4 group-hover:bg-indigo-600 transition-colors"><BarChart className="text-indigo-600 group-hover:text-white transition-colors" /></div>
              <h3 className="text-lg font-bold text-slate-900 mb-1">MVIC 分析</h3><p className="text-xs text-slate-500">最大等長收縮基準測試，可自動尋找起點並儲存結果至資料庫。</p>
            </div>
            <div onClick={() => setCurrentView('task_lift')} className="bg-white p-6 rounded-3xl border border-slate-200 hover:border-blue-400 hover:shadow-lg transition-all cursor-pointer group">
              <div className="bg-blue-50 w-12 h-12 rounded-2xl flex items-center justify-center mb-4 group-hover:bg-blue-500 transition-colors"><ArrowUpRight className="text-blue-500 group-hover:text-white transition-colors" /></div>
              <h3 className="text-lg font-bold text-slate-900 mb-1">舉手動作分析</h3><p className="text-xs text-slate-500">Peak-Valley Auto Detection，精準提取各角度區間與瞬時動態特徵。</p>
            </div>
            <div onClick={() => setCurrentView('task_openstring')} className="bg-white p-6 rounded-3xl border border-slate-200 hover:border-blue-400 hover:shadow-lg transition-all cursor-pointer group">
              <div className="bg-blue-50 w-12 h-12 rounded-2xl flex items-center justify-center mb-4 group-hover:bg-blue-500 transition-colors"><Music className="text-blue-500 group-hover:text-white transition-colors" /></div>
              <h3 className="text-lg font-bold text-slate-900 mb-1">空弦分析</h3><p className="text-xs text-slate-500">樂器彈奏專用，擷取基礎發力基線與持續度。</p>
            </div>
            <div onClick={() => setCurrentView('task_scale')} className="bg-white p-6 rounded-3xl border border-slate-200 hover:border-blue-400 hover:shadow-lg transition-all cursor-pointer group">
              <div className="bg-blue-50 w-12 h-12 rounded-2xl flex items-center justify-center mb-4 group-hover:bg-blue-500 transition-colors"><ListMusic className="text-blue-500 group-hover:text-white transition-colors" /></div>
              <h3 className="text-lg font-bold text-slate-900 mb-1">音階分析</h3><p className="text-xs text-slate-500">樂器音階彈奏專用，擷取各音符轉換區間之肌力表現。</p>
            </div>
            <div onClick={() => setCurrentView('task_music')} className="bg-white p-6 rounded-3xl border border-slate-200 hover:border-blue-400 hover:shadow-lg transition-all cursor-pointer group">
              <div className="bg-blue-50 w-12 h-12 rounded-2xl flex items-center justify-center mb-4 group-hover:bg-blue-500 transition-colors"><PlaySquare className="text-blue-500 group-hover:text-white transition-colors" /></div>
              <h3 className="text-lg font-bold text-slate-900 mb-1">樂曲分析</h3><p className="text-xs text-slate-500">連續樂曲彈奏專用，評估長時間動態任務的整體表現與疲勞。</p>
            </div>
          </div>
        </section>
        
        <section>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 border-b border-slate-200 pb-2 gap-4">
            <div className="flex items-center gap-2"><Database size={20} className="text-emerald-600" /><h2 className="text-xl font-bold text-slate-800">數據結果資料庫</h2></div>
            <button onClick={handleExportExcel} disabled={isExporting} className={`flex items-center gap-2 px-5 py-2.5 rounded-xl transition-all shadow-sm text-sm font-bold text-white ${isExporting ? 'bg-slate-400 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-700 active:scale-95'}`}>
              {isExporting ? <Activity className="animate-spin" size={18} /> : <FileSpreadsheet size={18} />} {isExporting ? '生成 Excel 中...' : '批次匯出全部受測者 (SPSS 相容)'}
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div onClick={() => setCurrentView('result_mvic')} className="bg-slate-900 p-6 rounded-3xl border border-slate-800 hover:border-emerald-500 hover:shadow-xl transition-all cursor-pointer group relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-10"><Database size={100} /></div>
              <div className="flex justify-between items-center mb-4 relative z-10">
                <div className="bg-slate-800 w-12 h-12 rounded-2xl flex items-center justify-center group-hover:bg-emerald-500 transition-colors"><FolderOpen className="text-emerald-400 group-hover:text-white transition-colors" /></div>
                <span className="text-xs font-mono text-emerald-400 bg-emerald-900/50 px-2 py-1 rounded-md border border-emerald-800/50">MVIC Storage</span>
              </div>
              <h3 className="text-lg font-bold text-white mb-1 relative z-10">MVIC 歷史數據庫</h3><p className="text-xs text-slate-400 relative z-10">包含各肌肉三重複測試之 Mean RMS, 綜合平均與標準差計算。</p>
            </div>
            <div onClick={() => setCurrentView('result_task')} className="bg-slate-900 p-6 rounded-3xl border border-slate-800 hover:border-blue-500 hover:shadow-xl transition-all cursor-pointer group relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-10"><Activity size={100} /></div>
              <div className="flex justify-between items-center mb-4 relative z-10">
                <div className="bg-slate-800 w-12 h-12 rounded-2xl flex items-center justify-center group-hover:bg-blue-500 transition-colors"><Database className="text-blue-400 group-hover:text-white transition-colors" /></div>
                <span className="text-xs font-mono text-slate-500 bg-slate-800 px-2 py-1 rounded-md">Tasks Data</span>
              </div>
              <h3 className="text-lg font-bold text-white mb-1 relative z-10">任務數據總表</h3><p className="text-xs text-slate-400 relative z-10">包含舉手、空弦、音階與樂曲等動態任務之分析成果彙整。</p>
            </div>
            <div onClick={() => setCurrentView('result_overview')} className="bg-slate-900 p-6 rounded-3xl border border-slate-800 hover:border-purple-500 hover:shadow-xl transition-all cursor-pointer group relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-10"><Users size={100} /></div>
              <div className="flex justify-between items-center mb-4 relative z-10">
                <div className="bg-slate-800 w-12 h-12 rounded-2xl flex items-center justify-center group-hover:bg-purple-500 transition-colors"><Layers className="text-purple-400 group-hover:text-white transition-colors" /></div>
                <span className="text-xs font-mono text-purple-400 bg-purple-900/50 px-2 py-1 rounded-md border border-purple-800/50">Global Overview</span>
              </div>
              <h3 className="text-lg font-bold text-white mb-1 relative z-10">所有個案總覽</h3><p className="text-xs text-slate-400 relative z-10">全局檢視所有受測者進度、資料完整度，與跨受測者狀態管理。</p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );

  switch (currentView) {
    case 'home': return renderHome();
    case 'mvic': return <MvicAnalysis activeSubjectId={activeSubjectId} onBack={() => setCurrentView('home')} mvicData={mvicData} setMvicData={setMvicData} />;
    case 'result_mvic': return <MvicDatabase activeSubjectId={activeSubjectId} mvicData={mvicData} setMvicData={setMvicData} onBack={() => setCurrentView('home')} />;
    case 'task_lift': return <LiftingAnalysis activeSubjectId={activeSubjectId} onBack={() => setCurrentView('home')} taskLiftEmgData={taskLiftEmgData} setTaskLiftEmgData={setTaskLiftEmgData} taskLiftAngleData={taskLiftAngleData} setTaskLiftAngleData={setTaskLiftAngleData} />;
    case 'task_openstring': return <ModulePlaceholder title="空弦分析" description="Open String Task Analysis" icon={<Music size={32} />} onBack={() => setCurrentView('home')} />;
    case 'task_scale': return <ModulePlaceholder title="音階分析" description="Scale Task Analysis" icon={<ListMusic size={32} />} onBack={() => setCurrentView('home')} />;
    case 'task_music': return <ModulePlaceholder title="樂曲分析" description="Musical Piece Task Analysis" icon={<PlaySquare size={32} />} onBack={() => setCurrentView('home')} />;
    case 'result_overview':
      return <GlobalDatabaseOverview subjects={subjects} setSubjects={setSubjects} activeSubjectId={activeSubjectId} setActiveSubjectId={setActiveSubjectId} onBack={() => setCurrentView('home')} />;
    case 'result_task': 
      return <TaskDatabase 
               activeSubjectId={activeSubjectId}
               onBack={() => setCurrentView('home')} 
               taskLiftEmgData={taskLiftEmgData} setTaskLiftEmgData={setTaskLiftEmgData} 
               taskLiftAngleData={taskLiftAngleData} setTaskLiftAngleData={setTaskLiftAngleData} 
               taskOpenStringData={taskOpenStringData} setTaskOpenStringData={setTaskOpenStringData}
               taskScaleData={taskScaleData} setTaskScaleData={setTaskScaleData}
               taskMusicData={taskMusicData} setTaskMusicData={setTaskMusicData}
             />;
    default: return renderHome();
  }
};

const MetricCard = ({ title, value, unit, icon }) => (
  <div className="bg-white p-4 rounded-3xl border border-slate-100 shadow-sm flex flex-col justify-center">
    <div className="p-1.5 bg-slate-50 w-fit rounded-lg mb-2">{icon}</div>
    <div className="flex items-baseline gap-1">
      <h3 className="text-xl font-black text-slate-900 font-mono leading-none">{value}</h3>
      <span className="text-[10px] font-bold text-slate-400 uppercase">{unit}</span>
    </div>
    <p className="text-[9px] font-bold text-slate-500 mt-1 uppercase tracking-wider line-clamp-1">{title}</p>
  </div>
);

const SimpleTooltip = ({ active, payload, dataKey, label, color }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white/90 backdrop-blur-md p-2 border border-slate-100 shadow-xl rounded-xl text-[10px]">
        <p className="font-bold text-slate-400">Time: {payload[0].payload.time || payload[0].payload.sample}s</p>
        <p style={{ color }} className="font-bold font-mono">{label}: {payload[0].payload[dataKey]} {dataKey.includes('angle')?'°':'mV'}</p>
      </div>
    );
  }
  return null;
};

const Placeholder = ({ error }) => (
  <div className="w-full h-full flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-3xl text-slate-400 italic text-sm p-4 text-center bg-slate-50/50">
    {error ? <span className="text-rose-500 font-bold">{error}</span> : "等待數據載入..."}
  </div>
);

export default App;