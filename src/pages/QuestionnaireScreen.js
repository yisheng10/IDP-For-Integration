import { Stack } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { auth, db } from '../firebase';
import {
  buildEproAnswerSummary,
  deriveSubjectId,
  fetchDailySurvey,
  mirrorEproOperationalRecord,
  submitDailySurvey,
} from '../services/eproService';

function inferQuestionType(question) {
  const text = (question.question_text || question.question || '').toLowerCase();
  if (question.question_type) {
    return question.question_type;
  }
  if (text.includes('(yes/no)')) {
    return 'boolean';
  }
  if (text.includes('(0-10)')) {
    return 'numeric_scale';
  }
  if (text.includes('describe') || text.includes('elaborate')) {
    return 'text';
  }
  return 'text';
}

function normalizeBoolean(value) {
  if (value === true || value === 'Yes' || value === 'yes') return true;
  if (value === false || value === 'No' || value === 'no') return false;
  return value;
}

function isQuestionVisible(question, answers) {
  if (!question.conditional_logic) {
    return true;
  }

  const expected = normalizeBoolean(question.conditional_logic.value);
  const actual = normalizeBoolean(answers[question.conditional_logic.question_id]);

  return actual === expected;
}

function getQuestionId(question) {
  return question.question_id || question.id;
}

function getQuestionText(question) {
  return question.question_text || question.question || 'Untitled question';
}

export default function QuestionnaireScreen() {
  const [profile, setProfile] = useState(null);
  const [survey, setSurvey] = useState(null);
  const [answers, setAnswers] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const loadSurvey = useCallback(async (isRefresh = false) => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      setError('Please sign in again to continue.');
      setLoading(false);
      return;
    }

    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const profileSnap = await getDoc(doc(db, 'users', currentUser.uid));
      const profileData = profileSnap.exists() ? profileSnap.data() : {};
      const patientName =
        profileData.nickname ||
        [profileData.firstName, profileData.lastName].filter(Boolean).join(' ') ||
        currentUser.email ||
        'Patient';
      const subjectId = deriveSubjectId(currentUser, profileData);

      const payload = await fetchDailySurvey({ subjectId, patientName });

      setProfile({
        ...profileData,
        patientName,
        subjectId,
        userId: currentUser.uid,
      });
      setSurvey(payload);
      setAnswers({});
      setError('');

      if (!payload.trial_complete && !payload.awaiting_crc_review) {
        await mirrorEproOperationalRecord({
          userId: currentUser.uid,
          subjectId,
          formId: payload.form_id,
          dayNumber: typeof payload.day_number === 'number' ? payload.day_number : payload.day,
          assignedAt: payload.assigned_at,
          dueAt: payload.due_at,
          status: payload.status || 'assigned',
          sourceSystem: payload.source_system,
          questionCount: Array.isArray(payload.questions) ? payload.questions.length : 0,
          reviewStatus: payload.review_status,
          reviewScope: payload.review_scope,
          reviewCutoffAt: payload.review_cutoff_at,
          patientVisibleAt: payload.patient_visible_at,
          approvedAt: payload.approved_at,
          approvedBy: payload.approved_by,
          autoReleasedAt: payload.auto_released_at,
        });
      }
    } catch (loadError) {
      setError(loadError.message || 'Unable to load questionnaire.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadSurvey();
  }, [loadSurvey]);

  const visibleQuestions = useMemo(() => {
    const questions = Array.isArray(survey?.questions) ? survey.questions : [];
    return questions.filter((question) => isQuestionVisible(question, answers));
  }, [survey, answers]);

  const handleAnswer = (questionId, value) => {
    setAnswers((current) => ({ ...current, [questionId]: value }));
  };

  const handleSubmit = async () => {
    if (!profile || !survey) {
      return;
    }

    const firstMissing = visibleQuestions.find((question) => {
      const questionId = getQuestionId(question);
      const value = answers[questionId];
      return value === undefined || value === null || value === '';
    });

    if (firstMissing) {
      Alert.alert('Incomplete questionnaire', `Please answer: ${getQuestionText(firstMissing)}`);
      return;
    }

    setSubmitting(true);
    try {
      const answerSummary = buildEproAnswerSummary({
        questions: visibleQuestions,
        answers,
      });
      const payload = await submitDailySurvey({
        subjectId: profile.subjectId,
        patientName: profile.patientName,
        answers,
      });

      await mirrorEproOperationalRecord({
        userId: profile.userId,
        subjectId: profile.subjectId,
        formId: payload.form_id || survey.form_id,
        dayNumber: typeof payload.day_number === 'number' ? payload.day_number : survey.day,
        assignedAt: survey.assigned_at,
        dueAt: survey.due_at,
        submittedAt: payload.submitted_at,
        status: payload.status || 'submitted',
        completionLatencySec: payload.completion_latency_sec,
        sourceSystem: payload.source_system,
        questionCount: visibleQuestions.length,
        painScore: answerSummary.painScore,
        anxietyScore: answerSummary.anxietyScore,
        basePositiveFlags: answerSummary.basePositiveFlags,
        hasFreeTextFollowup: answerSummary.hasFreeTextFollowup,
        reviewStatus: payload.review_status || survey.review_status,
        reviewScope: survey.review_scope,
        reviewCutoffAt: survey.review_cutoff_at,
        patientVisibleAt: survey.patient_visible_at,
        approvedAt: survey.approved_at,
        approvedBy: survey.approved_by,
        autoReleasedAt: survey.auto_released_at,
      });

      Alert.alert('Questionnaire submitted', 'Your CRC-facing operational record has been updated.');
      await loadSurvey();
    } catch (submitError) {
      Alert.alert('Submission failed', submitError.message || 'Unable to submit questionnaire.');
    } finally {
      setSubmitting(false);
    }
  };

  const renderBooleanQuestion = (question) => {
    const questionId = getQuestionId(question);
    return (
      <View style={styles.choiceRow}>
        {[
          { label: 'Yes', value: true },
          { label: 'No', value: false },
        ].map((option) => (
          <TouchableOpacity
            key={option.label}
            style={[
              styles.choiceButton,
              answers[questionId] === option.value && styles.choiceButtonActive,
            ]}
            onPress={() => handleAnswer(questionId, option.value)}
          >
            <Text
              style={[
                styles.choiceText,
                answers[questionId] === option.value && styles.choiceTextActive,
              ]}
            >
              {option.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  const renderNumericQuestion = (question) => {
    const questionId = getQuestionId(question);
    return (
      <View style={styles.scaleWrap}>
        {Array.from({ length: 11 }, (_, value) => value).map((value) => (
          <TouchableOpacity
            key={value}
            style={[
              styles.scaleChip,
              answers[questionId] === value && styles.scaleChipActive,
            ]}
            onPress={() => handleAnswer(questionId, value)}
          >
            <Text
              style={[
                styles.scaleChipText,
                answers[questionId] === value && styles.scaleChipTextActive,
              ]}
            >
              {value}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  const renderTextQuestion = (question) => {
    const questionId = getQuestionId(question);
    return (
      <TextInput
        style={styles.textArea}
        multiline
        placeholder="Type your answer here..."
        value={answers[questionId] || ''}
        onChangeText={(value) => handleAnswer(questionId, value)}
      />
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ title: 'ePRO Questionnaire' }} />
        <ActivityIndicator size="large" color="#0056b3" />
        <Text style={styles.loadingText}>Loading today&apos;s questionnaire...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'ePRO Questionnaire' }} />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadSurvey(true)} />}
      >
        <View style={styles.summaryCard}>
          <Text style={styles.title}>ePRO Questionnaire</Text>
          <Text style={styles.subtitle}>{profile?.patientName || 'Patient'}</Text>
          <Text style={styles.metaText}>Subject ID: {profile?.subjectId}</Text>
          {survey?.trial_complete ? (
            <Text style={styles.completeText}>This questionnaire schedule is complete.</Text>
          ) : (
            <>
              <Text style={styles.metaText}>Day {survey?.day}</Text>
              <Text style={styles.metaText}>
                Due by: {survey?.due_at ? new Date(survey.due_at).toLocaleString() : 'Not set'}
              </Text>
            </>
          )}
        </View>

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Questionnaire unavailable</Text>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={() => loadSurvey()}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {!error && survey?.trial_complete ? (
          <View style={styles.completeCard}>
            <Text style={styles.completeTitle}>Schedule completed</Text>
            <Text style={styles.completeBody}>
              There is no new questionnaire pending for this subject right now.
            </Text>
          </View>
        ) : null}

        {!error && survey?.awaiting_crc_review ? (
          <View style={styles.awaitingCard}>
            <Text style={styles.awaitingTitle}>Awaiting CRC review</Text>
            <Text style={styles.awaitingBody}>
              Today&apos;s questionnaire is awaiting CRC review.
            </Text>
            <Text style={styles.awaitingMeta}>
              Review cutoff: {survey?.review_cutoff_at ? new Date(survey.review_cutoff_at).toLocaleString() : 'Not set'}
            </Text>
          </View>
        ) : null}

        {!error && !survey?.trial_complete && !survey?.awaiting_crc_review
          ? visibleQuestions.map((question) => {
              const questionType = inferQuestionType(question);
              const questionId = getQuestionId(question);
              const questionText = getQuestionText(question);

              return (
                <View key={questionId} style={styles.questionCard}>
                  <View style={styles.questionHeader}>
                    <Text style={styles.questionText}>{questionText}</Text>
                    {question.tier ? (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{question.tier}</Text>
                      </View>
                    ) : null}
                  </View>

                  {questionType === 'boolean' && renderBooleanQuestion(question)}
                  {questionType === 'numeric_scale' && renderNumericQuestion(question)}
                  {questionType === 'text' && renderTextQuestion(question)}
                </View>
              );
            })
          : null}

        {!error && !survey?.trial_complete && !survey?.awaiting_crc_review ? (
          <TouchableOpacity
            style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={submitting}
          >
            <Text style={styles.submitText}>
              {submitting ? 'Submitting...' : `Submit Day ${survey?.day || ''} Questionnaire`}
            </Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#eef3f8',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#eef3f8',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    color: '#355070',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  summaryCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#d9e3ef',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#14324a',
  },
  subtitle: {
    marginTop: 4,
    fontSize: 16,
    color: '#355070',
    fontWeight: '600',
  },
  metaText: {
    marginTop: 6,
    color: '#5b7083',
    fontSize: 13,
  },
  questionCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#d9e3ef',
  },
  questionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14,
  },
  questionText: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    color: '#14324a',
    fontWeight: '600',
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#edf4ff',
  },
  badgeText: {
    fontSize: 11,
    color: '#0056b3',
    fontWeight: '700',
  },
  choiceRow: {
    flexDirection: 'row',
    gap: 10,
  },
  choiceButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#bfd0e2',
    backgroundColor: '#f8fbff',
    alignItems: 'center',
  },
  choiceButtonActive: {
    backgroundColor: '#0056b3',
    borderColor: '#0056b3',
  },
  choiceText: {
    color: '#33516e',
    fontWeight: '600',
  },
  choiceTextActive: {
    color: '#ffffff',
  },
  scaleWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  scaleChip: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#bfd0e2',
    backgroundColor: '#f8fbff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scaleChipActive: {
    backgroundColor: '#0056b3',
    borderColor: '#0056b3',
  },
  scaleChipText: {
    color: '#33516e',
    fontWeight: '700',
  },
  scaleChipTextActive: {
    color: '#ffffff',
  },
  textArea: {
    minHeight: 110,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#bfd0e2',
    backgroundColor: '#f8fbff',
    padding: 14,
    textAlignVertical: 'top',
    color: '#14324a',
  },
  submitButton: {
    marginTop: 8,
    backgroundColor: '#00796b',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  submitButtonDisabled: {
    backgroundColor: '#8aa5a0',
  },
  submitText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 16,
  },
  errorCard: {
    backgroundColor: '#fff4f4',
    borderColor: '#ffc9c9',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#8d1e1e',
  },
  errorText: {
    marginTop: 8,
    color: '#7a3f3f',
    lineHeight: 20,
  },
  retryButton: {
    marginTop: 14,
    alignSelf: 'flex-start',
    backgroundColor: '#8d1e1e',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  retryText: {
    color: '#ffffff',
    fontWeight: '600',
  },
  completeCard: {
    backgroundColor: '#f0fff7',
    borderColor: '#bfe5cf',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  completeTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#136741',
  },
  completeBody: {
    marginTop: 8,
    color: '#2a6d4c',
    lineHeight: 20,
  },
  completeText: {
    marginTop: 10,
    color: '#136741',
    fontWeight: '600',
  },
  awaitingCard: {
    backgroundColor: '#fff8e8',
    borderColor: '#f0d79a',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  awaitingTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#8a5a00',
  },
  awaitingBody: {
    marginTop: 8,
    color: '#7a6226',
    lineHeight: 20,
  },
  awaitingMeta: {
    marginTop: 10,
    color: '#8a6a1d',
    fontSize: 13,
  },
});
