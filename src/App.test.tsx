import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import App from './App';

// Usa IDs repetidos entre categorias para verificar que o progresso é independente.
jest.mock('./data/questions', () => ({
  questionsByCategory: {
    filmes: [
      { id: 1, audioSrc: '/filme_1.mp3', posterSrc: '/filme_1.jpg', title: 'Filme 1' },
      { id: 2, audioSrc: '/filme_2.mp3', posterSrc: '/filme_2.jpg', title: 'Filme 2' },
    ],
    desenhos: [
      { id: 1, audioSrc: '/desenho_1.mp3', posterSrc: '/desenho_1.jpg', title: 'Desenho 1' },
    ],
    novelas: [],
    seriados: [],
  },
}));

beforeEach(() => {
  jest.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

const selectCategory = (name: RegExp) => {
  fireEvent.click(screen.getByRole('button', { name }));
};

const openFirstQuestion = () => {
  fireEvent.click(screen.getByRole('button', { name: /^Pergunta 1/ }));
};

const closeQuestion = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Fechar pergunta' }));
};

const backToCategories = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Trocar categoria' }));
};

test('mostra as quatro categorias antes dos números', () => {
  render(<App />);

  expect(screen.getByRole('heading', { name: 'Escolha uma categoria' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Filmes 2 perguntas' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Desenhos 1 pergunta' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Novelas Em breve' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Seriados Em breve' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Pergunta / })).not.toBeInTheDocument();
});

test('mostra somente os números e o título da categoria selecionada', () => {
  render(<App />);
  selectCategory(/^Filmes /);

  expect(screen.getByRole('heading', { name: 'Qual é o Filme?' })).toBeInTheDocument();
  expect(within(screen.getByRole('main')).getAllByRole('button')).toHaveLength(2);

  backToCategories();
  selectCategory(/^Desenhos /);

  expect(screen.getByRole('heading', { name: 'Qual é o Desenho?' })).toBeInTheDocument();
  expect(within(screen.getByRole('main')).getAllByRole('button')).toHaveLength(1);
  expect(screen.queryByRole('button', { name: 'Pergunta 2' })).not.toBeInTheDocument();
});

test.each(['Novelas', 'Seriados'])('permite visitar %s vazia e voltar às categorias', (category) => {
  render(<App />);
  selectCategory(new RegExp(`^${category} `));

  expect(screen.getByRole('heading', { name: 'Em breve!' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Pergunta / })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Resetar categoria' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Voltar às categorias' }));
  expect(screen.getByRole('heading', { name: 'Escolha uma categoria' })).toBeInTheDocument();
});

test('preserva perguntas abertas ao trocar de categoria sem misturar IDs iguais', () => {
  render(<App />);
  selectCategory(/^Filmes /);
  openFirstQuestion();
  closeQuestion();

  expect(screen.getByRole('button', { name: 'Pergunta 1, já aberta' })).toHaveClass('answered');
  backToCategories();
  selectCategory(/^Desenhos /);
  expect(screen.getByRole('button', { name: 'Pergunta 1' })).not.toHaveClass('answered');

  backToCategories();
  selectCategory(/^Filmes /);
  expect(screen.getByRole('button', { name: 'Pergunta 1, já aberta' })).toHaveClass('answered');
});

test('reseta somente a categoria atual e respeita o cancelamento', () => {
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
  render(<App />);
  selectCategory(/^Desenhos /);
  openFirstQuestion();
  closeQuestion();
  backToCategories();

  selectCategory(/^Filmes /);
  openFirstQuestion();
  closeQuestion();
  fireEvent.click(screen.getByRole('button', { name: 'Resetar categoria' }));
  expect(confirm).toHaveBeenCalledWith('Tem certeza que deseja resetar as perguntas abertas de Filmes?');
  expect(screen.getByRole('button', { name: 'Pergunta 1, já aberta' })).toHaveClass('answered');

  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Resetar categoria' }));
  expect(screen.getByRole('button', { name: 'Pergunta 1' })).not.toHaveClass('answered');

  backToCategories();
  selectCategory(/^Desenhos /);
  expect(screen.getByRole('button', { name: 'Pergunta 1, já aberta' })).toHaveClass('answered');
});

test('mantém o áudio e a revelação da imagem na categoria escolhida', () => {
  render(<App />);
  selectCategory(/^Desenhos /);
  openFirstQuestion();

  expect(screen.getByRole('dialog', { name: 'Pergunta 1' })).toBeInTheDocument();
  fireEvent.click(screen.getByText('🔒'));
  expect(screen.queryByRole('img')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Tocar áudio' }));
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText('?'));
  expect(screen.getByRole('img', { name: 'Desenho 1' })).toHaveAttribute('src', '/desenho_1.jpg');

  closeQuestion();
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  openFirstQuestion();
  expect(screen.getByText('🔒')).toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});
