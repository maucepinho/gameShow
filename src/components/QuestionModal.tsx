import React, { useState, useRef, useEffect } from 'react';
import { Question } from '../types/Question';
import './QuestionModal.css';

interface Props {
  question: Question;
  onClose: () => void;
  buzzerContent?: React.ReactNode;
  pauseSignal?: string;
}

export const QuestionModal: React.FC<Props> = ({ question, onClose, buzzerContent, pauseSignal }) => {
  const [isRevealed, setIsRevealed] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [hasStartedPlaying, setHasStartedPlaying] = useState(false);
  const [audioError, setAudioError] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = new Audio(question.audioSrc);
    audioRef.current = audio;
    const setAudioData = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    const setAudioTime = () => setCurrentTime(audio.currentTime);
    const handleEnded = () => { setIsPlaying(false); setCurrentTime(0); };
    audio.addEventListener('loadedmetadata', setAudioData);
    audio.addEventListener('timeupdate', setAudioTime);
    audio.addEventListener('ended', handleEnded);
    return () => {
      audio.pause();
      audioRef.current = null;
      audio.removeEventListener('loadedmetadata', setAudioData);
      audio.removeEventListener('timeupdate', setAudioTime);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [question.audioSrc]);

  useEffect(() => {
    if (!pauseSignal || !audioRef.current) return;
    audioRef.current.pause();
    setIsPlaying(false);
  }, [pauseSignal]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      return;
    }
    const handleFailure = () => {
      if (audioRef.current !== audio) return;
      setIsPlaying(false);
      setAudioError('Não foi possível tocar este áudio. Confira o arquivo e tente novamente.');
    };
    try {
      const playing = audio.play();
      setIsPlaying(true);
      setHasStartedPlaying(true);
      setAudioError('');
      if (playing?.catch) void playing.catch(handleFailure);
    } catch { handleFailure(); }
  };

  const handleSeek = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = value;
      setCurrentTime(value);
    }
  };
  const formatTime = (value: number) => {
    if (!Number.isFinite(value)) return '00:00';
    return `${Math.floor(value / 60).toString().padStart(2, '0')}:${Math.floor(value % 60).toString().padStart(2, '0')}`;
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal-content${buzzerContent ? ' with-buzzer' : ''}`} role="dialog" aria-modal="true" aria-label={`Pergunta ${question.id}`} onClick={(event) => event.stopPropagation()}>
        <button className="close-button" aria-label="Fechar pergunta" onClick={onClose}>X</button>
        <div className="question-layout">
          <div className="question-media">
            <div
              className={`card ${!hasStartedPlaying ? 'locked' : ''} ${isRevealed ? 'revealed' : ''}`}
              onClick={() => { if (hasStartedPlaying) setIsRevealed(true); }}
              role="button"
              tabIndex={hasStartedPlaying && !isRevealed ? 0 : -1}
              aria-label={isRevealed ? 'Resposta revelada' : 'Revelar resposta'}
              aria-disabled={!hasStartedPlaying || isRevealed}
              onKeyDown={(event) => {
                if (hasStartedPlaying && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault();
                  setIsRevealed(true);
                }
              }}
            >
              {isRevealed
                ? <img src={question.posterSrc} alt={question.title} className="poster-image" />
                : <div className="question-mark">{!hasStartedPlaying ? '🔒' : '?'}</div>}
            </div>
            <div className="audio-controls-container">
              <div className="timeline-container">
                <span className="time-text">{formatTime(currentTime)}</span>
                <input type="range" aria-label="Posição do áudio" className="seek-bar" min="0" max={duration} value={currentTime} onChange={handleSeek} />
                <span className="time-text">{formatTime(duration)}</span>
              </div>
              <div className="buttons-row">
                <button className={`control-button ${isPlaying ? 'paused' : ''}`} aria-label={isPlaying ? 'Pausar áudio' : 'Tocar áudio'} onClick={togglePlay}>
                  {isPlaying ? '⏸️' : '▶️'}
                </button>
              </div>
              {audioError && <p role="alert" className="audio-error">{audioError}</p>}
            </div>
          </div>
          {buzzerContent && <aside className="question-buzzer" aria-label="Buzzer da pergunta">{buzzerContent}</aside>}
        </div>
      </div>
    </div>
  );
};
