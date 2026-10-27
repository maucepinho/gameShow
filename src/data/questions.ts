import { CategoryId } from '../types/Category';
import { Question } from '../types/Question';
import { buildQuestionsByCategory, MediaFiles } from './questionLoader';

// As subpastas identificam as categorias; mídias na raiz ainda são aceitas como Filmes por compatibilidade.
const audioContext = require.context('../assets/audio', true, /\.mp3$/i);
const imageContext = require.context('../assets/images', true, /\.(png|jpe?g|webp)$/i);

const readFiles = (context: __WebpackModuleApi.RequireContext): MediaFiles =>
  context.keys().reduce<MediaFiles>((files, fileName) => {
    files[fileName] = context(fileName) as string;
    return files;
  }, {});

export const questionsByCategory: Record<CategoryId, Question[]> = buildQuestionsByCategory(
  readFiles(audioContext),
  readFiles(imageContext),
);
