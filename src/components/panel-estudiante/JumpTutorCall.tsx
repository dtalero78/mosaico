'use client';

/**
 * Jump Tutor — Realtime voice exam (WebRTC client controller).
 *
 * Ported from asistente-medico-bsl/webrtc.js to TS/React:
 *  1. POST /jump-tutor/session  → ephemeral client_secret + dynamic instructions + tool
 *  2. getUserMedia(audio) → RTCPeerConnection (+ remote <audio>)
 *  3. DataChannel "oai-events" → on open, send session.update (instructions + tool)
 *  4. SDP offer → POST https://api.openai.com/v1/realtime/calls (Bearer client_secret)
 *  5. On tool call submitJumpEvaluation → POST /jump-tutor/report → function_call_output
 *
 * OPENAI_API_KEY never reaches the browser; only the short-lived secret does.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';

type Phase = 'idle' | 'connecting' | 'live' | 'submitting' | 'done' | 'error';

const WRAP_UP_MS = 5 * 60 * 1000;          // 5 min → pedir despedida + reporte
const HARD_CLOSE_AFTER_WRAP_MS = 30 * 1000; // backstop si el modelo no cierra

interface SessionResponse {
  evaluationId: string;
  clientSecret: string;
  model: string;
  voice: string;
  instructions: string;
  tools: any[];
  nivel: string;
  jumpStep: string;
}

export default function JumpTutorCall({ onFinished }: { onFinished?: () => void }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [nivel, setNivel] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const evaluationIdRef = useRef<string | null>(null);
  const startedAtRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const capRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptRef = useRef<Array<{ role: string; text: string }>>([]);
  const reportSentRef = useRef(false);
  const endedRef = useRef(false);

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (capRef.current) clearTimeout(capRef.current);
    if (hardCloseRef.current) clearTimeout(hardCloseRef.current);
    timerRef.current = null;
    capRef.current = null;
    hardCloseRef.current = null;
    try { dcRef.current?.close(); } catch {}
    try { pcRef.current?.close(); } catch {}
    micRef.current?.getTracks().forEach((t) => t.stop());
    dcRef.current = null;
    pcRef.current = null;
    micRef.current = null;
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  // Forward the bot's evaluation report to our backend (tool backend).
  const submitReport = useCallback(async (args: any, durationSec: number) => {
    if (reportSentRef.current) return { success: true };
    reportSentRef.current = true;
    setPhase('submitting');
    try {
      const res = await fetch('/api/postgres/panel-estudiante/jump-tutor/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          evaluationId: evaluationIdRef.current,
          report: { ...args, durationSec, transcript: transcriptRef.current },
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'No se pudo guardar el reporte');
      return { success: true };
    } catch (e: any) {
      reportSentRef.current = false;
      return { success: false, error: e.message };
    }
  }, []);

  const endCall = useCallback((finalPhase: Phase = 'done') => {
    if (endedRef.current) return;
    endedRef.current = true;
    cleanup();
    setPhase(finalPhase);
    onFinished?.();
  }, [cleanup, onFinished]);

  const handleMessage = useCallback(async (ev: MessageEvent) => {
    let msg: any;
    try { msg = JSON.parse(ev.data); } catch { return; }

    // Lightweight transcript capture (best-effort, optional).
    if (msg.type === 'conversation.item.input_audio_transcription.completed' && msg.transcript) {
      transcriptRef.current.push({ role: 'student', text: msg.transcript });
    }
    if (msg.type === 'response.output_audio_transcript.done' && msg.transcript) {
      transcriptRef.current.push({ role: 'tutor', text: msg.transcript });
    }

    // The single tool: submitJumpEvaluation
    if (msg.type === 'response.function_call_arguments.done' && msg.name === 'submitJumpEvaluation') {
      let args: any = {};
      try { args = JSON.parse(msg.arguments || '{}'); } catch {}
      const durationSec = Math.round((Date.now() - startedAtRef.current) / 1000);
      const result = await submitReport(args, durationSec);

      // Return tool output to the model so it can close gracefully.
      try {
        dcRef.current?.send(JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: msg.call_id,
            output: JSON.stringify(result),
          },
        }));
      } catch {}

      // Give the model a couple seconds to say goodbye, then end.
      setTimeout(() => endCall('done'), 4000);
    }
  }, [submitReport, endCall]);

  const start = useCallback(async () => {
    setErrorMsg(null);
    setPhase('connecting');
    reportSentRef.current = false;
    endedRef.current = false;
    transcriptRef.current = [];

    try {
      // 1. Ephemeral session + dynamic instructions
      const sres = await fetch('/api/postgres/panel-estudiante/jump-tutor/session', { method: 'POST' });
      const sjson = await sres.json();
      if (!sjson.success || !sjson.clientSecret) {
        throw new Error(sjson.error || 'No se pudo iniciar la sesión');
      }
      const data = sjson as SessionResponse;
      evaluationIdRef.current = data.evaluationId;
      setNivel(data.nivel);

      // 2. Mic + peer connection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      audioElRef.current = audioEl;
      pc.ontrack = (e) => { audioEl.srcObject = e.streams[0]; };

      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      micRef.current = mic;
      pc.addTrack(mic.getTracks()[0]);

      pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        if (st === 'connected') {
          startedAtRef.current = Date.now();
          setPhase('live');
          timerRef.current = setInterval(
            () => setElapsed(Math.round((Date.now() - startedAtRef.current) / 1000)),
            1000
          );
          // A los 5 min: pedirle al bot que se despida en español y mande el
          // reporte. Si no cumple, cierre forzado como respaldo.
          capRef.current = setTimeout(() => {
            if (reportSentRef.current) { endCall('done'); return; }
            try {
              dcRef.current?.send(JSON.stringify({
                type: 'response.create',
                response: {
                  instructions:
                    'El tiempo de evaluación (5 minutos) terminó. Deja de hacer preguntas ahora. Despídete del estudiante con calidez EN ESPAÑOL, agradécele su tiempo, y luego llama la herramienta submitJumpEvaluation con tu reporte. No reveles el veredicto.',
                },
              }));
            } catch {}
            toast('Cerrando la evaluación…', { icon: '⏱️' });
            hardCloseRef.current = setTimeout(
              () => endCall(reportSentRef.current ? 'done' : 'error'),
              HARD_CLOSE_AFTER_WRAP_MS
            );
          }, WRAP_UP_MS);
        } else if (st === 'failed' || st === 'closed') {
          endCall(reportSentRef.current ? 'done' : 'error');
        }
      };

      // 3. DataChannel → send dynamic instructions + tool on open
      const dc = pc.createDataChannel('oai-events');
      dcRef.current = dc;
      dc.addEventListener('open', () => {
        dc.send(JSON.stringify({
          type: 'session.update',
          session: { type: 'realtime', instructions: data.instructions, tools: data.tools },
        }));
      });
      dc.addEventListener('message', handleMessage);

      // 4. SDP exchange
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpRes = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${data.clientSecret}`,
          'Content-Type': 'application/sdp',
        },
      });
      if (!sdpRes.ok) throw new Error(`Fallo el handshake con OpenAI [${sdpRes.status}]`);
      const answer = { type: 'answer' as const, sdp: await sdpRes.text() };
      await pc.setRemoteDescription(answer);
    } catch (e: any) {
      console.error('JumpTutorCall start error:', e);
      cleanup();
      setErrorMsg(e?.message || 'Error al conectar');
      setPhase('error');
    }
  }, [cleanup, endCall, handleMessage]);

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;

  return (
    <div className="rounded-2xl border border-indigo-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Examen Jump {nivel ? `· ${nivel}` : ''}</h3>
          <p className="text-sm text-gray-500">Evaluación oral en inglés con tu tutor virtual</p>
        </div>
        {phase === 'live' && (
          <span className="rounded-full bg-indigo-50 px-3 py-1 font-mono text-sm text-indigo-700">{mmss}</span>
        )}
      </div>

      {phase === 'idle' && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Hablarás en inglés con un tutor que evaluará tu nivel completo. Dura ~5–8 minutos.
            Necesitas permitir el micrófono. Al terminar, un asesor revisará tu resultado.
          </p>
          <button
            onClick={start}
            className="w-full rounded-lg bg-indigo-600 px-4 py-3 font-medium text-white hover:bg-indigo-700"
          >
            🎙️ Iniciar examen Jump
          </button>
        </div>
      )}

      {phase === 'connecting' && (
        <p className="text-sm text-gray-600">Conectando con tu tutor…</p>
      )}

      {phase === 'live' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-green-700">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-green-500" />
            En vivo — habla con naturalidad en inglés
          </div>
          <button
            onClick={() => endCall('done')}
            className="w-full rounded-lg border border-red-300 px-4 py-2 text-red-600 hover:bg-red-50"
          >
            Terminar
          </button>
        </div>
      )}

      {phase === 'submitting' && (
        <p className="text-sm text-gray-600">Guardando tu evaluación, no cierres esta ventana…</p>
      )}

      {phase === 'done' && (
        <div className="space-y-2">
          <p className="font-medium text-green-700">✓ Examen completado.</p>
          <p className="text-sm text-gray-600">
            Tu evaluación fue registrada. Un asesor la revisará y aprobará tu avance. ¡Gracias!
          </p>
        </div>
      )}

      {phase === 'error' && (
        <div className="space-y-3">
          <p className="text-sm text-red-600">{errorMsg || 'Ocurrió un error.'}</p>
          <button
            onClick={start}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Reintentar
          </button>
        </div>
      )}
    </div>
  );
}
