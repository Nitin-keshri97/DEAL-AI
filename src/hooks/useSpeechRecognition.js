import { useCallback, useEffect, useRef, useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────
// useSpeechRecognition — Web Speech API wrapper with robust accumulation & debounce.
//
// Solves premature-submit bugs by:
//  1. Continuous listening (`continuous = true`).
//  2. Accumulating all final transcript segments across results and session restarts.
//  3. Distinguishing interim vs final results.
//  4. Waiting for a silence debounce window (~1000ms) before submitting.
//  5. Resetting silence debounce timer whenever new speech/interim input arrives.
//  6. Preventing empty or duplicate submissions.
//  7. Adding explicit debug logs: [Voice] INTERIM:, [Voice] FINAL:, [Voice] RECOGNITION_END:, [Voice] SUBMIT:
// ─────────────────────────────────────────────────────────────────────────
export function useSpeechRecognition({ lang = 'en-IN', onResult } = {}) {
  const Recognition =
    typeof window !== 'undefined'
      ? window.SpeechRecognition || window.webkitSpeechRecognition
      : null;
  const supported = Boolean(Recognition);

  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState(null);

  const recognitionRef = useRef(null);
  const onResultRef = useRef(onResult);

  const accumulatedFinalRef = useRef('');
  const sessionFinalRef = useRef('');
  const lastSubmittedRef = useRef('');
  const lastLoggedFinalRef = useRef('');
  const isListeningRequestedRef = useRef(false);
  const debounceTimerRef = useRef(null);

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  const clearDebounceTimer = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  const triggerSubmit = useCallback((rawText) => {
    clearDebounceTimer();

    const clean = String(rawText || '').trim();
    if (!clean) return;
    if (clean === lastSubmittedRef.current) return;

    lastSubmittedRef.current = clean;
    console.log('[Voice] SUBMIT:', clean);

    isListeningRequestedRef.current = false;
    setListening(false);
    setInterim('');
    setTranscript(clean);

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
    }

    if (onResultRef.current) {
      onResultRef.current(clean);
    }
  }, [clearDebounceTimer]);

  useEffect(() => {
    if (!supported) return undefined;

    const rec = new Recognition();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      let sFinal = '';
      let sInterim = '';

      for (let i = 0; i < event.results.length; i += 1) {
        const res = event.results[i];
        const text = res[0]?.transcript || '';
        if (res.isFinal) {
          sFinal += (sFinal ? ' ' : '') + text.trim();
        } else {
          sInterim += (sInterim ? ' ' : '') + text.trim();
        }
      }

      sessionFinalRef.current = sFinal;
      const totalFinal = (accumulatedFinalRef.current + ' ' + sFinal).trim();

      if (sInterim) {
        console.log('[Voice] INTERIM:', sInterim);
      }

      if (totalFinal && totalFinal !== lastLoggedFinalRef.current) {
        lastLoggedFinalRef.current = totalFinal;
        console.log('[Voice] FINAL:', totalFinal);
      }

      const liveText = (totalFinal + (sInterim ? ' ' + sInterim : '')).trim();
      setInterim(liveText);
      setTranscript(totalFinal);

      // Cancel any pending submit on new speech input
      clearDebounceTimer();

      // Only schedule submission if we have non-empty candidate text
      if (totalFinal) {
        debounceTimerRef.current = setTimeout(() => {
          triggerSubmit(totalFinal);
        }, 1000);
      }
    };

    rec.onerror = (event) => {
      const errName = event?.error;
      if (errName === 'no-speech') {
        const currentTotal = (accumulatedFinalRef.current + ' ' + sessionFinalRef.current).trim();
        if (currentTotal && currentTotal !== lastSubmittedRef.current && !debounceTimerRef.current) {
          debounceTimerRef.current = setTimeout(() => {
            triggerSubmit(currentTotal);
          }, 800);
        }
        return;
      }
      setError(errName || 'speech-error');
      isListeningRequestedRef.current = false;
      setListening(false);
      clearDebounceTimer();
    };

    rec.onend = () => {
      console.log('[Voice] RECOGNITION_END:');

      const currentTotal = (accumulatedFinalRef.current + ' ' + sessionFinalRef.current).trim();
      accumulatedFinalRef.current = currentTotal;
      sessionFinalRef.current = '';

      if (isListeningRequestedRef.current) {
        if (currentTotal && currentTotal !== lastSubmittedRef.current) {
          if (!debounceTimerRef.current) {
            debounceTimerRef.current = setTimeout(() => {
              triggerSubmit(currentTotal);
            }, 800);
          }
        } else {
          // Restart recognition if user is still in listening mode but browser stopped unexpectedly
          try {
            rec.start();
          } catch {
            setListening(false);
            isListeningRequestedRef.current = false;
          }
        }
      } else {
        setListening(false);
      }
    };

    recognitionRef.current = rec;

    return () => {
      clearDebounceTimer();
      try {
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        rec.abort();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    };
  }, [supported, lang, Recognition, clearDebounceTimer, triggerSubmit]);

  const start = useCallback(() => {
    if (!supported || !recognitionRef.current) return;

    clearDebounceTimer();
    accumulatedFinalRef.current = '';
    sessionFinalRef.current = '';
    lastSubmittedRef.current = '';
    lastLoggedFinalRef.current = '';
    isListeningRequestedRef.current = true;

    setError(null);
    setInterim('');
    setTranscript('');

    try {
      recognitionRef.current.start();
      setListening(true);
    } catch {
      setListening(true);
    }
  }, [supported, clearDebounceTimer]);

  const stop = useCallback(() => {
    isListeningRequestedRef.current = false;
    clearDebounceTimer();

    const currentTotal = (accumulatedFinalRef.current + ' ' + sessionFinalRef.current).trim();
    if (currentTotal && currentTotal !== lastSubmittedRef.current) {
      triggerSubmit(currentTotal);
    } else {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
      }
      setListening(false);
    }
  }, [clearDebounceTimer, triggerSubmit]);

  const reset = useCallback(() => {
    clearDebounceTimer();
    accumulatedFinalRef.current = '';
    sessionFinalRef.current = '';
    lastSubmittedRef.current = '';
    lastLoggedFinalRef.current = '';
    isListeningRequestedRef.current = false;
    setInterim('');
    setTranscript('');
    setError(null);
  }, [clearDebounceTimer]);

  return { supported, listening, interim, transcript, error, start, stop, reset };
}

export default useSpeechRecognition;

