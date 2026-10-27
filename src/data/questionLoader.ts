import { CategoryId } from '../types/Category';
import { Question } from '../types/Question';
import { categories } from './categories';

export type MediaFiles = Record<string, string>;
type CategorizedMedia = Record<CategoryId, Record<number, string>>;

const questionNames: Record<CategoryId, string> = {
  filmes: 'Filme',
  desenhos: 'Desenho',
  novelas: 'Novela',
  seriados: 'Seriado',
};

const groupMedia = (files: MediaFiles, extension: RegExp): CategorizedMedia => {
  const grouped: CategorizedMedia = { filmes: {}, desenhos: {}, novelas: {}, seriados: {} };

  // Arquivos legados têm prioridade se um ID for repetido na pasta filmes.
  const fileNames = Object.keys(files).sort((a, b) =>
    a.split('/').length - b.split('/').length || a.localeCompare(b),
  );

  fileNames.forEach((fileName) => {
    const parts = fileName.replace(/^\.\//, '').split('/');
    const categoryName = parts.length === 1 ? 'filmes' : parts[0];
    const category = categories.find((item) => item.id === categoryName);
    const baseName = parts[parts.length - 1];

    if (!category || parts.length > 2 || !extension.test(baseName)) return;

    // Apenas o número após o último "_" é o ID: "filme_1917_36.mp3" → 36.
    const match = baseName.match(/^.+_(\d+)\.[^.]+$/);
    if (!match) return;

    const id = Number(match[1]);
    if (!Number.isSafeInteger(id) || id <= 0) return;

    if (grouped[category.id][id] === undefined) {
      grouped[category.id][id] = files[fileName];
    }
  });

  return grouped;
};

export const buildQuestionsByCategory = (
  audioFiles: MediaFiles,
  imageFiles: MediaFiles,
): Record<CategoryId, Question[]> => {
  const audio = groupMedia(audioFiles, /\.mp3$/i);
  const images = groupMedia(imageFiles, /\.(png|jpe?g|webp)$/i);
  const questions: Record<CategoryId, Question[]> = {
    filmes: [], desenhos: [], novelas: [], seriados: [],
  };

  categories.forEach(({ id: categoryId }) => {
    questions[categoryId] = Object.keys(audio[categoryId])
      .map(Number)
      .sort((a, b) => a - b)
      .map((id) => ({
        id,
        audioSrc: audio[categoryId][id],
        // Um áudio existente continua disponível mesmo sem sua imagem.
        posterSrc: images[categoryId][id] || '',
        title: `${questionNames[categoryId]} ${id}`,
      }));
  });

  return questions;
};
