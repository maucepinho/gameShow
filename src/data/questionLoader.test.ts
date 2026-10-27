import { buildQuestionsByCategory } from './questionLoader';

test('mantém os arquivos da raiz em filmes e ordena os IDs numéricos', () => {
  const result = buildQuestionsByCategory(
    { './filme_1917_10.mp3': 'audio10', './outro_2.mp3': 'audio2' },
    { './filme_1917_10.jpg': 'image10', './outro_2.webp': 'image2' },
  );

  expect(result.filmes).toEqual([
    { id: 2, audioSrc: 'audio2', posterSrc: 'image2', title: 'Filme 2' },
    { id: 10, audioSrc: 'audio10', posterSrc: 'image10', title: 'Filme 10' },
  ]);
  expect(result.desenhos).toEqual([]);
  expect(result.novelas).toEqual([]);
  expect(result.seriados).toEqual([]);
});

test('carrega subpastas automaticamente e permite o mesmo ID em categorias diferentes', () => {
  const result = buildQuestionsByCategory(
    {
      './filmes/filme_1.mp3': 'filme-audio',
      './desenhos/desenho_1.mp3': 'desenho-audio',
      './novelas/novela_1.mp3': 'novela-audio',
      './seriados/seriado_1.mp3': 'seriado-audio',
    },
    {
      './filmes/filme_1.png': 'filme-image',
      './desenhos/desenho_1.jpg': 'desenho-image',
      './novelas/novela_1.jpeg': 'novela-image',
      './seriados/seriado_1.webp': 'seriado-image',
    },
  );

  expect(result.filmes[0]).toMatchObject({ id: 1, audioSrc: 'filme-audio', posterSrc: 'filme-image' });
  expect(result.desenhos[0]).toMatchObject({ id: 1, audioSrc: 'desenho-audio', posterSrc: 'desenho-image' });
  expect(result.novelas[0]).toMatchObject({ id: 1, audioSrc: 'novela-audio', posterSrc: 'novela-image' });
  expect(result.seriados[0]).toMatchObject({ id: 1, audioSrc: 'seriado-audio', posterSrc: 'seriado-image' });
});

test('ignora IDs inválidos, categorias desconhecidas e subpastas extras', () => {
  const result = buildQuestionsByCategory(
    {
      './filme.mp3': 'no-id',
      './1917.mp3': 'title-number',
      './filme_0.mp3': 'zero',
      './filme_-1.mp3': 'negative',
      './filme_1.5.mp3': 'decimal',
      './filme_9007199254740992.mp3': 'unsafe',
      './musicas/musica_1.mp3': 'unknown-category',
      './filmes/subpasta/filme_1.mp3': 'nested',
    },
    {},
  );

  expect(Object.values(result).every((questions) => questions.length === 0)).toBe(true);
});

test('preserva áudios sem imagem e não mistura imagens entre categorias', () => {
  const result = buildQuestionsByCategory(
    { './filme_1.mp3': 'audio1', './desenhos/desenho_2.mp3': 'audio2' },
    { './novelas/novela_1.jpg': 'other-category-image', './imagem_3.png': 'orphan-image' },
  );

  expect(result.filmes[0].posterSrc).toBe('');
  expect(result.desenhos[0].posterSrc).toBe('');
  expect(result.filmes).toHaveLength(1);
  expect(result.novelas).toEqual([]);
});

test('prioriza os arquivos legados quando há IDs duplicados em filmes', () => {
  const result = buildQuestionsByCategory(
    { './filmes/novo_1.mp3': 'new-audio', './original_1.mp3': 'legacy-audio' },
    { './filmes/novo_1.jpg': 'new-image', './original_1.jpg': 'legacy-image' },
  );

  expect(result.filmes).toEqual([
    { id: 1, audioSrc: 'legacy-audio', posterSrc: 'legacy-image', title: 'Filme 1' },
  ]);
});
