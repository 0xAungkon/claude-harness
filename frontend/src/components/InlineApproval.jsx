import React, { useEffect, useMemo, useState } from 'react';
import { ToolIcon } from '../icons';

function actionSummary(toolName, toolInput = {}) {
  if (toolName === 'Bash' || toolName === 'PowerShell') return toolInput.command || 'Run a shell command';
  if (toolName === 'Write' || toolName === 'Edit' || toolName === 'NotebookEdit') return toolInput.file_path || toolInput.notebook_path || 'Modify a file';
  if (toolName === 'WebFetch') return toolInput.url || 'Fetch a web page';
  if (toolName === 'ExitPlanMode') return 'Claude is ready to leave plan mode and continue.';
  return toolInput.description || `${toolName || 'Claude Code'} wants to perform an action.`;
}

function suggestedRule(approval) {
  const toolName = approval?.toolName || 'Tool';
  const suggestions = Array.isArray(approval?.permissionSuggestions) ? approval.permissionSuggestions : [];
  for (const suggestion of suggestions) {
    if (suggestion?.type !== 'addRules' || !Array.isArray(suggestion.rules)) continue;
    const match = suggestion.rules.find((rule) => rule?.toolName === toolName && typeof rule?.ruleContent === 'string');
    if (match?.ruleContent) return match.ruleContent;
  }
  const input = approval?.toolInput || {};
  if (toolName === 'Bash' || toolName === 'PowerShell') return input.command || '';
  if (toolName === 'WebFetch') return input.url || '';
  if (toolName === 'Write' || toolName === 'Edit' || toolName === 'NotebookEdit') return input.file_path || input.notebook_path || '';
  return '';
}

function QuestionRow({ question, value, onChange }) {
  const options = Array.isArray(question?.options) ? question.options : [];
  const multi = Boolean(question?.multiSelect);
  const selected = multi ? (Array.isArray(value) ? value : []) : (typeof value === 'string' ? value : '');
  const [custom, setCustom] = useState('');

  const toggle = (label) => {
    if (!multi) return onChange(label);
    onChange(selected.includes(label) ? selected.filter((item) => item !== label) : [...selected, label]);
  };

  const updateCustom = (next) => {
    setCustom(next);
    const trimmed = next.trim();
    if (trimmed) onChange(multi ? [trimmed] : trimmed);
  };

  return (
    <div className="inline-question-row">
      {question?.header && <div className="inline-approval-kicker">{question.header}</div>}
      <div className="inline-question-title">{question?.question || 'Claude needs your input'}</div>
      {options.length > 0 && (
        <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {options.map((option) => {
            const active = multi ? selected.includes(option.label) : selected === option.label;
            return (
              <button
                key={option.label}
                type="button"
                onClick={() => toggle(option.label)}
                className={`inline-question-option ${active ? 'is-selected' : ''}`}
              >
                <span className={`inline-question-dot ${multi ? 'rounded-[5px]' : 'rounded-full'} ${active ? 'is-selected' : ''}`}>{active ? '✓' : ''}</span>
                <span className="min-w-0 text-left">
                  <span className="block font-medium text-harness-primary">{option.label}</span>
                  {option.description && <span className="mt-0.5 block text-[13px] leading-5 text-harness-muted">{option.description}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <input
        value={custom}
        onChange={(event) => updateCustom(event.target.value)}
        className="inline-approval-field mt-2 w-full"
        placeholder="Type your answer…"
      />
    </div>
  );
}

export default function InlineApproval({ approval, onRespond = async () => {} }) {
  const questions = useMemo(() => Array.isArray(approval?.questions) ? approval.questions : [], [approval]);
  const isQuestion = approval?.kind === 'question' || approval?.toolName === 'AskUserQuestion';
  const [answers, setAnswers] = useState({});
  const [rule, setRule] = useState('');
  const [submitting, setSubmitting] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setAnswers({});
    setRule(suggestedRule(approval));
    setSubmitting('');
    setError('');
  }, [approval?.id]);

  if (!approval) return null;

  const respond = async (action, extra = {}) => {
    setSubmitting(action);
    setError('');
    try {
      await onRespond(approval.id, { action, ...extra });
    } catch (requestError) {
      setError(requestError?.message || 'Unable to send this response to Claude Code.');
      setSubmitting('');
    }
  };

  const submitQuestions = () => {
    const normalized = {};
    for (const question of questions) {
      const value = answers[question.question];
      if (Array.isArray(value)) normalized[question.question] = value.join(', ');
      else if (typeof value === 'string' && value.trim()) normalized[question.question] = value.trim();
    }
    respond('allow', { answers: normalized });
  };

  if (isQuestion) {
    return (
      <div className="inline-approval-panel" role="group" aria-label="Claude needs your input">
        <div className="flex items-start gap-3">
          <div className="inline-approval-icon"><ToolIcon className="h-4 w-4" /></div>
          <div className="min-w-0 flex-1">
            <div className="inline-approval-title">Claude needs your input</div>
            <div className="inline-approval-subtitle">{approval.sessionName ? `${approval.sessionName}${approval.workspaceName ? ` · ${approval.workspaceName}` : ''}` : 'Claude Code session'} · Answer here to continue.</div>
          </div>
        </div>
        <div className="mt-3 grid gap-2.5">
          {questions.length ? questions.map((question, index) => (
            <QuestionRow
              key={`${question.question || 'question'}-${index}`}
              question={question}
              value={answers[question.question]}
              onChange={(next) => setAnswers((current) => ({ ...current, [question.question]: next }))}
            />
          )) : <div className="inline-approval-action">Claude requested interactive input.</div>}
        </div>
        {error && <div className="inline-approval-error">{error}</div>}
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <button type="button" disabled={Boolean(submitting)} onClick={() => respond('deny', { message: 'User cancelled the question.' })} className="inline-approval-btn">Cancel</button>
          <button type="button" disabled={Boolean(submitting)} onClick={submitQuestions} className="inline-approval-btn is-primary">{submitting ? 'Sending…' : 'Submit answer'}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="inline-approval-panel" role="group" aria-label="Approval required">
      <div className="flex items-start gap-3">
        <div className="inline-approval-icon"><ToolIcon className="h-4 w-4" /></div>
        <div className="min-w-0 flex-1">
          <div className="inline-approval-title">Approval required</div>
          <div className="inline-approval-subtitle">{approval.sessionName ? `${approval.sessionName} · ` : ''}{approval.toolName}{approval.workspaceName ? ` · ${approval.workspaceName}` : ''}</div>
        </div>
      </div>

      <div className="inline-approval-action mt-3">
        <div className="inline-approval-kicker">Requested action</div>
        <div className="mt-1 break-words font-mono text-[14px] leading-5 text-harness-primary">{actionSummary(approval.toolName, approval.toolInput)}</div>
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between gap-3">
          <label className="text-[13px] font-semibold text-harness-primary" htmlFor={`permission-rule-${approval.id}`}>Always allow rule</label>
          <span className="text-[12px] text-harness-muted">Editable before approval</span>
        </div>
        <input
          id={`permission-rule-${approval.id}`}
          value={rule}
          onChange={(event) => setRule(event.target.value)}
          className="inline-approval-field mt-1.5 w-full font-mono"
          placeholder={`Rule for ${approval.toolName || 'this tool'} — e.g. curl *`}
          spellCheck={false}
        />
        <div className="mt-1.5 text-[12px] leading-5 text-harness-muted">This field only controls <strong>Always allow</strong>. It does not change the command Claude is about to run.</div>
      </div>

      {error && <div className="inline-approval-error">{error}</div>}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button type="button" disabled={Boolean(submitting)} onClick={() => respond('deny', { message: 'User denied the action.' })} className="inline-approval-btn">Deny</button>
        <button type="button" disabled={Boolean(submitting)} onClick={() => respond('always_allow', { permissionRule: rule.trim() })} className="inline-approval-btn">{submitting === 'always_allow' ? 'Saving…' : 'Always allow'}</button>
        <button type="button" disabled={Boolean(submitting)} onClick={() => respond('allow')} className="inline-approval-btn is-primary">{submitting === 'allow' ? 'Allowing…' : 'Allow once'}</button>
      </div>
    </div>
  );
}
