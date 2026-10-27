import React, { useState } from 'react';
import './App.css';
import { categories } from './data/categories';
import { questionsByCategory } from './data/questions';
import { CategoryId } from './types/Category';
import { Question } from './types/Question';
import { QuestionModal } from './components/QuestionModal';

function App() {
  const [selectedCategoryId, setSelectedCategoryId] = useState<CategoryId | null>(null);
  const [selectedQuestion, setSelectedQuestion] = useState<Question | null>(null);
  const [openedQuestionIds, setOpenedQuestionIds] = useState<Partial<Record<CategoryId, number[]>>>({});

  const selectedCategory = categories.find((category) => category.id === selectedCategoryId);
  const questions = selectedCategoryId ? questionsByCategory[selectedCategoryId] : [];
  const openedIds = selectedCategoryId ? openedQuestionIds[selectedCategoryId] ?? [] : [];

  const handleOpenModal = (question: Question) => {
    if (!selectedCategoryId) return;

    setSelectedQuestion(question);
    setOpenedQuestionIds((previous) => {
      const categoryIds = previous[selectedCategoryId] ?? [];
      if (categoryIds.includes(question.id)) return previous;

      return { ...previous, [selectedCategoryId]: [...categoryIds, question.id] };
    });
  };

  const handleBackToCategories = () => {
    setSelectedQuestion(null);
    setSelectedCategoryId(null);
  };

  const handleReset = () => {
    if (!selectedCategory) return;

    if (window.confirm(`Tem certeza que deseja resetar as perguntas abertas de ${selectedCategory.name}?`)) {
      setOpenedQuestionIds((previous) => ({ ...previous, [selectedCategory.id]: [] }));
    }
  };

  return (
    <div className="App">
      {selectedCategory ? (
        <>
          <nav className="game-actions" aria-label="Controles do jogo">
            <button className="back-button" onClick={handleBackToCategories}>
              <span aria-hidden="true">← </span>Trocar categoria
            </button>
            {questions.length > 0 && (
              <button className="reset-button" onClick={handleReset}>
                <span aria-hidden="true">🔄 </span>Resetar categoria
              </button>
            )}
          </nav>

          <header className="App-header">
            <p className="category-label">{selectedCategory.name}</p>
            <h1>{selectedCategory.title}</h1>
            {questions.length > 0 && <p>Escolha um número e descubra pelo som.</p>}
          </header>

          {questions.length > 0 ? (
            <main className="game-board" aria-label={`Perguntas de ${selectedCategory.name}`}>
              {questions.map((question) => {
                const isOpened = openedIds.includes(question.id);

                return (
                  <button
                    key={question.id}
                    className={`question-button ${isOpened ? 'answered' : ''}`}
                    aria-label={`Pergunta ${question.id}${isOpened ? ', já aberta' : ''}`}
                    onClick={() => handleOpenModal(question)}
                  >
                    {question.id}
                  </button>
                );
              })}
            </main>
          ) : (
            <main className="empty-category">
              <span className="category-icon" aria-hidden="true">{selectedCategory.icon}</span>
              <h2>Em breve!</h2>
              <p>Esta categoria ainda não tem perguntas. Escolha outra para jogar.</p>
              <button className="back-button" onClick={handleBackToCategories}>
                Voltar às categorias
              </button>
            </main>
          )}
        </>
      ) : (
        <>
          <header className="App-header category-header">
            <p className="category-label">Game Show</p>
            <h1>Escolha uma categoria</h1>
            <p>Ouça a trilha, dê seu palpite e revele a resposta.</p>
          </header>

          <main className="category-board" aria-label="Categorias">
            {categories.map((category) => {
              const questionCount = questionsByCategory[category.id].length;

              return (
                <button
                  key={category.id}
                  className={`category-button ${questionCount === 0 ? 'coming-soon' : ''}`}
                  onClick={() => setSelectedCategoryId(category.id)}
                >
                  <span className="category-icon" aria-hidden="true">{category.icon}</span>
                  <span className="category-name">{category.name}</span>
                  <span className="category-status">
                    {questionCount > 0
                      ? `${questionCount} ${questionCount === 1 ? 'pergunta' : 'perguntas'}`
                      : 'Em breve'}
                  </span>
                </button>
              );
            })}
          </main>
        </>
      )}

      {selectedQuestion && (
        <QuestionModal
          question={selectedQuestion}
          onClose={() => setSelectedQuestion(null)}
        />
      )}
    </div>
  );
}

export default App;
