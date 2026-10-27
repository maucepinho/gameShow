// src/components/QuestionModal.tsx
import React, { useState, useRef, useEffect } from 'react';
import { Question } from '../types/Question';
import './QuestionModal.css';

interface Props {
  question: Question;
  onClose: () => void;
}

export const QuestionModal: React.FC<Props> = ({ question, onClose }) => {
  const [isRevealed, setIsRevealed] = useState(false);
  
  // Controle de áudio e tempo
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  
  // NOVO: Estado para saber se o usuário já deu play alguma vez
  const [hasStartedPlaying, setHasStartedPlaying] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = new Audio(question.audioSrc);
    audioRef.current = audio;

    const setAudioData = () => setDuration(audio.duration);
    const setAudioTime = () => setCurrentTime(audio.currentTime);
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener('loadedmetadata', setAudioData);
    audio.addEventListener('timeupdate', setAudioTime);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.pause();
      audio.removeEventListener('loadedmetadata', setAudioData);
      audio.removeEventListener('timeupdate', setAudioTime);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [question.audioSrc]);

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
        // Marca que o jogo começou (libera o clique na carta)
        setHasStartedPlaying(true);
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = Number(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  const handleReveal = () => {
    // BLOQUEIO: Se ainda não deu play, não faz nada
    if (!hasStartedPlaying) {
        return; 
    }
    setIsRevealed(true);
  };

  const formatTime = (time: number) => {
    if (isNaN(time)) return "00:00";
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" role="dialog" aria-modal="true" aria-label={`Pergunta ${question.id}`} onClick={(e) => e.stopPropagation()}>
        <button className="close-button" aria-label="Fechar pergunta" onClick={onClose}>X</button>
        
        {/* Adicionei a classe 'locked' se ainda não tiver tocado */}
        <div 
            className={`card ${!hasStartedPlaying ? 'locked' : ''} ${isRevealed ? 'revealed' : ''}`} 
            onClick={handleReveal}
        >
          {isRevealed ? (
            <img src={question.posterSrc} alt={question.title} className="poster-image" />
          ) : (
            // Se estiver travado, mostra um ícone de cadeado ou opacidade diferente?
            <div className="question-mark">
                {!hasStartedPlaying ? '🔒' : '?'}
            </div>
          )}
        </div>

        <div className="audio-controls-container">
          <div className="timeline-container">
            <span className="time-text">{formatTime(currentTime)}</span>
            <input 
              type="range" 
              className="seek-bar"
              min="0" 
              max={duration} 
              value={currentTime} 
              onChange={handleSeek}
            />
            <span className="time-text">{formatTime(duration)}</span>
          </div>

          <div className="buttons-row">
            <button className={`control-button ${isPlaying ? 'paused' : ''}`} aria-label={isPlaying ? 'Pausar áudio' : 'Tocar áudio'} onClick={togglePlay}>
              {isPlaying ? '⏸️' : '▶️'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
/*// src/components/QuestionModal.tsx
import React, { useState, useRef, useEffect } from 'react';
import { Question } from '../types/Question';
import './QuestionModal.css';

interface Props {
  question: Question;
  onClose: () => void;
}

export const QuestionModal: React.FC<Props> = ({ question, onClose }) => {
  const [isRevealed, setIsRevealed] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Efeito para parar a música quando o modal for fechado
  useEffect(() => {
    // A função retornada pelo useEffect é a função de "limpeza"
    // Ela será executada quando o componente for "desmontado" (fechado)
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, []);


  const handlePlayAudio = () => {
    if (!audioRef.current) {
      audioRef.current = new Audio(question.audioSrc);
    }
    audioRef.current.play();
  };

  const handleReveal = () => {
    setIsRevealed(true);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="close-button" onClick={onClose}>X</button>
        
        <div className="card" onClick={handleReveal}>
          {isRevealed ? (
            <img src={question.posterSrc} alt={question.movieTitle} className="poster-image" />
          ) : (
            <div className="question-mark">?</div>
          )}
        </div>

        <button className="play-button" onClick={handlePlayAudio}>
          ▶️
        </button>
      </div>
    </div>
  );
};*/
