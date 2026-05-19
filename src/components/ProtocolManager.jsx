import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import { coerceNotificationPolicy, getDefaultNotificationPolicy } from '../services/incidentService';
import {
  deleteGuidanceDocumentChunks,
  ingestGuidanceDocument,
} from '../services/guidanceIngestionService';
import { supabase } from '../supabaseClient';
import {
  buildFallbackMonitoredVitals,
  coerceVitalTemplates,
  findBuiltinVitalTemplate,
  getBuiltinVitalLibrary,
  isBuiltinVitalTemplate,
  subscribeToTrialTemplates,
} from '../services/trialTemplateService';
import {
  finalizeUploadedProtocolTemplate,
  getProtocolStaticContextStatus,
} from '../services/protocolStaticContextService';
import {
  configureProtocolDropoutTrial,
  getSupportedDropoutTrialMetadata,
  normalizeDropoutTrialId,
  reconcileProtocolDropoutTrialBinding,
} from '../services/dropoutTrialRegistryService';

const POLICY_FIELDS = ['mild', 'moderate', 'serious'];
const DUE_UNITS = ['hour', 'day', 'week', 'month'];

function normalizeText(value) {
  return String(value || '').trim();
}

function hoursFromUnit(value, unit) {
  const safeValue = Math.max(1, Number(value) || 1);
  switch (unit) {
    case 'day':
      return safeValue * 24;
    case 'week':
      return safeValue * 24 * 7;
    case 'month':
      return safeValue * 24 * 30;
    case 'hour':
    default:
      return safeValue;
  }
}

function backfillDueValue(entry = {}) {
  const dueUnit = entry.due_unit || 'hour';
  const dueHours = Number(entry.due_in_hours) || 1;

  if (entry.due_value) {
    return {
      ...entry,
      due_value: String(entry.due_value),
      due_unit: dueUnit,
      due_in_hours: hoursFromUnit(entry.due_value, dueUnit),
    };
  }

  if (dueUnit === 'day' && dueHours % 24 === 0) {
    return { ...entry, due_value: String(dueHours / 24), due_unit: 'day', due_in_hours: dueHours };
  }

  if (dueUnit === 'week' && dueHours % (24 * 7) === 0) {
    return { ...entry, due_value: String(dueHours / (24 * 7)), due_unit: 'week', due_in_hours: dueHours };
  }

  if (dueUnit === 'month' && dueHours % (24 * 30) === 0) {
    return { ...entry, due_value: String(dueHours / (24 * 30)), due_unit: 'month', due_in_hours: dueHours };
  }

  return {
    ...entry,
    due_value: String(dueHours),
    due_unit: 'hour',
    due_in_hours: dueHours,
  };
}

function normalizePolicyForDraft(policy = {}) {
  const normalized = coerceNotificationPolicy(policy);
  const nextPolicy = {};
  POLICY_FIELDS.forEach((severity) => {
    nextPolicy[severity] = backfillDueValue(normalized[severity]);
  });
  return nextPolicy;
}

function normalizePolicyForSave(policy = {}) {
  const nextPolicy = {};
  POLICY_FIELDS.forEach((severity) => {
    const entry = policy[severity] || {};
    const dueValue = String(entry.due_value || '1').replace(/[^0-9]/g, '') || '1';
    const dueUnit = DUE_UNITS.includes(entry.due_unit) ? entry.due_unit : 'hour';
    nextPolicy[severity] = {
      ...entry,
      due_value: dueValue,
      due_unit: dueUnit,
      due_in_hours: hoursFromUnit(dueValue, dueUnit),
      action_code: String(entry.action_code || ''),
      instruction: String(entry.instruction || ''),
      notification_tier: String(entry.notification_tier || ''),
    };
  });
  return coerceNotificationPolicy(nextPolicy);
}

function buildDraft(protocol) {
  return {
    notification_policy: normalizePolicyForDraft(protocol.notification_policy || getDefaultNotificationPolicy()),
    vital_templates: coerceVitalTemplates(protocol.vital_templates, protocol.monitoredVitals),
    dropout_trial_id: protocol.dropout_trial_id || '',
  };
}

function buildPatientDropoutTrialFields(protocol = null) {
  const normalizedTrialId = normalizeDropoutTrialId(protocol?.dropout_trial_id);
  return {
    dropout_trial_id: normalizedTrialId || null,
    dropout_trial_label: protocol?.dropout_trial_label || normalizedTrialId || null,
    dropout_trial_status: protocol?.dropout_trial_status || (normalizedTrialId ? 'configured' : 'not_configured'),
    dropout_trial_pool_size: Number(protocol?.dropout_trial_pool_size) || null,
    dropout_trial_model_version: protocol?.dropout_trial_model_version || null,
    dropout_trial_last_verified_at: protocol?.dropout_trial_last_verified_at || null,
    dropout_trial_last_synced_at: protocol?.dropout_trial_last_synced_at || null,
  };
}

function buildDropoutTrialFieldStatus(protocol = {}, draftTrialId = '') {
  const normalizedDraftTrialId = normalizeDropoutTrialId(draftTrialId);
  const normalizedSavedTrialId = normalizeDropoutTrialId(protocol?.dropout_trial_id);
  const savedStatus = normalizeText(protocol?.dropout_trial_status).toLowerCase();
  const matchStatus = normalizeText(protocol?.dropout_trial_match_status).toLowerCase();
  const matchCandidates = Array.isArray(protocol?.dropout_trial_match_candidates)
    ? protocol.dropout_trial_match_candidates.filter(Boolean)
    : [];
  const matchMessage = normalizeText(protocol?.dropout_trial_match_message);
  const supportedMetadata = getSupportedDropoutTrialMetadata(normalizedDraftTrialId);
  const usingSavedValue = normalizedDraftTrialId && normalizedDraftTrialId === normalizedSavedTrialId;
  const staticContextStatus = getProtocolStaticContextStatus(protocol);

  if (!normalizedDraftTrialId) {
    if (matchStatus === 'configured' && normalizedSavedTrialId) {
      return {
        tone: 'success',
        label: 'Configured',
        message:
          matchMessage ||
          'This protocol is already bound to a supported disengagement dataset trial and is ready for patient mapping.',
        blocking: false,
        poolSize: Number(protocol?.dropout_trial_pool_size) || null,
        modelVersion: protocol?.dropout_trial_model_version || '',
        lastVerifiedAt: protocol?.dropout_trial_last_verified_at || '',
      };
    }

    if (matchStatus === 'no_supported_trial_detected') {
      return {
        tone: 'warning',
        label: 'No supported dataset trial detected',
        message:
          matchMessage ||
          'Strict static context is ready, but no supported disengagement dataset trial ID was detected in the protocol PDF.',
        blocking: false,
        poolSize: null,
        modelVersion: '',
        lastVerifiedAt: '',
      };
    }

    if (matchStatus === 'multiple_supported_trials_detected') {
      return {
        tone: 'warning',
        label: 'Multiple supported dataset trials detected',
        message:
          matchMessage ||
          `Strict static context is ready, but multiple supported disengagement dataset trial IDs were detected: ${matchCandidates.join(', ')}`,
        blocking: false,
        poolSize: null,
        modelVersion: '',
        lastVerifiedAt: '',
      };
    }

    return {
      tone: 'warning',
      label: 'Not configured',
      message: 'This protocol is currently out of patient disengagement prediction until a supported dataset trial ID is configured.',
      blocking: false,
      poolSize: null,
      modelVersion: '',
      lastVerifiedAt: '',
    };
  }

  if (!staticContextStatus.ready) {
    return {
      tone: staticContextStatus.tone,
      label: staticContextStatus.label,
      message: `${staticContextStatus.message} Configure the disengagement dataset trial ID only after strict static context extraction reaches ready.`,
      blocking: true,
      poolSize: null,
      modelVersion: '',
      lastVerifiedAt: '',
    };
  }

  if (usingSavedValue && savedStatus) {
    if (savedStatus === 'configured') {
      return {
        tone: 'success',
        label: 'Configured',
        message: 'This protocol is bound to a supported disengagement trial and its canonical Subject ID pool is verified.',
        blocking: false,
        poolSize: Number(protocol?.dropout_trial_pool_size) || supportedMetadata?.expected_pool_size || null,
        modelVersion: protocol?.dropout_trial_model_version || supportedMetadata?.model_version_label || '',
        lastVerifiedAt: protocol?.dropout_trial_last_verified_at || '',
      };
    }

    if (savedStatus === 'model_unavailable') {
      return {
        tone: 'danger',
        label: 'No model configured',
        message: 'This trial ID is recognized, but no active disengagement model is configured for it.',
        blocking: true,
        poolSize: Number(protocol?.dropout_trial_pool_size) || supportedMetadata?.expected_pool_size || null,
        modelVersion: protocol?.dropout_trial_model_version || supportedMetadata?.model_version_label || '',
        lastVerifiedAt: protocol?.dropout_trial_last_verified_at || '',
      };
    }

    if (savedStatus === 'pool_unavailable' || savedStatus === 'sync_failed') {
      return {
        tone: 'danger',
        label: 'No canonical subject pool available',
        message: 'This trial ID is recognized, but its canonical Subject ID pool is not available yet.',
        blocking: true,
        poolSize: Number(protocol?.dropout_trial_pool_size) || supportedMetadata?.expected_pool_size || null,
        modelVersion: protocol?.dropout_trial_model_version || supportedMetadata?.model_version_label || '',
        lastVerifiedAt: protocol?.dropout_trial_last_verified_at || '',
      };
    }
  }

  if (!supportedMetadata) {
    return {
      tone: 'danger',
      label: 'Unknown trial ID',
      message: 'This disengagement dataset trial ID is not in the supported dropout registry, so save will be blocked.',
      blocking: true,
      poolSize: null,
      modelVersion: '',
      lastVerifiedAt: '',
    };
  }

  return {
    tone: 'brand',
    label: 'Supported trial ID',
    message: 'This trial ID is supported. Saving the template will verify it and sync its canonical Subject ID pool automatically.',
    blocking: false,
    poolSize: supportedMetadata.expected_pool_size,
    modelVersion: supportedMetadata.model_version_label,
    lastVerifiedAt: '',
  };
}

function isProtocolFullyConfiguredForDisengagement(protocol = null) {
  const staticContextStatus = getProtocolStaticContextStatus(protocol);
  const trialId = normalizeDropoutTrialId(protocol?.dropout_trial_id);
  const trialStatus = normalizeText(protocol?.dropout_trial_status).toLowerCase();
  return Boolean(staticContextStatus.ready && trialId && trialStatus === 'configured');
}

function buildProtocolAssignmentBlockReason(protocol = null) {
  const staticContextStatus = getProtocolStaticContextStatus(protocol);
  if (!staticContextStatus.ready) {
    return staticContextStatus.message;
  }
  const trialId = normalizeDropoutTrialId(protocol?.dropout_trial_id);
  const trialStatus = normalizeText(protocol?.dropout_trial_status).toLowerCase();
  if (!trialId) {
    return (
      normalizeText(protocol?.dropout_trial_match_message) ||
      'This protocol cannot be assigned until a supported disengagement dataset trial ID is configured.'
    );
  }
  if (trialStatus !== 'configured') {
    return 'This protocol cannot be assigned until its disengagement dataset trial binding is fully verified.';
  }
  return '';
}

function formatOptionalDate(value) {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) {
    return '';
  }
  const nextDate = new Date(normalizedValue);
  return Number.isNaN(nextDate.getTime()) ? normalizedValue : nextDate.toLocaleString();
}

function buildProtocolUploadStagingPath(fileName = '') {
  const safeName = String(fileName || '')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '') || 'protocol.pdf';
  return `protocol-upload-staging/${Date.now()}-${safeName}`;
}

function TemplateField({ label, children }) {
  return (
    <div className="protocol-library__field">
      <label className="protocol-library__fieldLabel">{label}</label>
      {children}
    </div>
  );
}

function handleTextareaAutoGrow(event) {
  const target = event.currentTarget;
  target.style.height = 'auto';
  target.style.height = `${target.scrollHeight}px`;
}

function renderThresholdFields(template, protocolId, templateIndex, onChange) {
  const thresholds = template.thresholds || {};

  if (template.input_type === 'blood_pressure') {
    const bpFields = [
      ['Systolic moderate low', 'systolic_moderate_low'],
      ['Systolic serious low', 'systolic_serious_low'],
      ['Systolic moderate high', 'systolic_moderate_high'],
      ['Systolic serious high', 'systolic_serious_high'],
      ['Diastolic moderate low', 'diastolic_moderate_low'],
      ['Diastolic serious low', 'diastolic_serious_low'],
      ['Diastolic moderate high', 'diastolic_moderate_high'],
      ['Diastolic serious high', 'diastolic_serious_high'],
    ];

    return (
      <div className="protocol-library__thresholdGrid protocol-library__thresholdGrid--bp">
        {bpFields.map(([label, key]) => (
          <TemplateField key={key} label={label}>
            <input
              value={thresholds[key] ?? ''}
              onChange={(event) => onChange(protocolId, templateIndex, key, event.target.value)}
              placeholder="Optional"
            />
          </TemplateField>
        ))}
      </div>
    );
  }

  const numericFields = [
    ['Moderate low', 'moderate_low'],
    ['Serious low', 'serious_low'],
    ['Moderate high', 'moderate_high'],
    ['Serious high', 'serious_high'],
  ];

  return (
    <div className="protocol-library__thresholdGrid">
      {numericFields.map(([label, key]) => (
        <TemplateField key={key} label={label}>
          <input
            value={thresholds[key] ?? ''}
            onChange={(event) => onChange(protocolId, templateIndex, key, event.target.value)}
            placeholder="Optional"
          />
        </TemplateField>
      ))}
    </div>
  );
}

function formatGuidanceIndexStatus(protocol) {
  const status = String(protocol?.guidance_index_status || '').trim().toLowerCase();
  if (status === 'ready') {
    const pageCount = Number(protocol?.guidance_page_count) || 0;
    const chunkCount = Number(protocol?.guidance_chunk_count) || 0;
    const indexedAt = protocol?.guidance_indexed_at
      ? new Date(protocol.guidance_indexed_at).toLocaleString()
      : null;
    return `Guidance index ready${pageCount || chunkCount ? `: ${pageCount} pages, ${chunkCount} chunks` : ''}${
      indexedAt ? ` (${indexedAt})` : ''
    }`;
  }

  if (status === 'indexing') {
    return 'Guidance indexing is running in the background.';
  }

  if (status === 'error') {
    const errorMessage = String(protocol?.guidance_index_error || '').trim();
    return `Guidance index error${errorMessage ? `: ${errorMessage}` : ''}`;
  }

  return 'Guidance index has not run yet.';
}

const ProtocolManager = ({ selectedPatient, patients = [] }) => {
  const [file, setFile] = useState(null);
  const [protocols, setProtocols] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [showUploadExceptionDialog, setShowUploadExceptionDialog] = useState(false);
  const [uploadExceptionPhaseOverride, setUploadExceptionPhaseOverride] = useState('');
  const [uploadExceptionConfirmValue, setUploadExceptionConfirmValue] = useState('');
  const [drafts, setDrafts] = useState({});
  const [builtinSelections, setBuiltinSelections] = useState({});
  const [expandedProtocolId, setExpandedProtocolId] = useState(null);
  const [savingProtocolId, setSavingProtocolId] = useState(null);
  const [protocolSaveFeedbackById, setProtocolSaveFeedbackById] = useState({});

  const builtinVitals = useMemo(() => getBuiltinVitalLibrary(), []);

  useEffect(() => {
    const unsubscribe = subscribeToTrialTemplates((rows) => {
      setProtocols(rows);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const nextDrafts = {};
    protocols.forEach((protocol) => {
      nextDrafts[protocol.id] = buildDraft(protocol);
    });
    setDrafts(nextDrafts);
  }, [protocols]);

  useEffect(() => {
    const selectedProtocolId =
      selectedPatient?.protocolId && protocols.some((protocol) => protocol.id === selectedPatient.protocolId)
        ? selectedPatient.protocolId
        : null;

    setExpandedProtocolId(selectedProtocolId || null);
  }, [protocols, selectedPatient?.protocolId]);

  const usageCounts = useMemo(() => {
    const counts = {};
    protocols.forEach((protocol) => {
      counts[protocol.id] = patients.filter((patient) => patient.protocolId === protocol.id).length;
    });
    return counts;
  }, [patients, protocols]);

  const assignedProtocolCount = useMemo(
    () => patients.filter((patient) => patient.protocolId || patient.protocolName).length,
    [patients]
  );

  const handleUpload = async (manualTrialPhaseOverride = '') => {
    if (!file) return false;
    setUploading(true);
    let uploadSucceeded = false;

    try {
      const fileName = file.name;
      const storagePath = buildProtocolUploadStagingPath(fileName);

      const { error: uploadError } = await supabase.storage.from('protocol').upload(storagePath, file, { upsert: true });
      if (uploadError) throw uploadError;

      const existingProtocol = protocols.find((protocol) => protocol.name === fileName) || null;
      const finalizeResult = await finalizeUploadedProtocolTemplate({
        protocolId: existingProtocol?.id || null,
        protocolName: fileName,
        stagedStorageBucket: 'protocol',
        stagedStoragePath: storagePath,
        manualTrialPhaseOverride,
      });
      const protocolId = String(finalizeResult?.protocolId || '').trim();
      const finalizedProtocol = finalizeResult?.protocol || null;

      if (!protocolId || !finalizedProtocol?.storagePath) {
        throw new Error('Strict protocol upload finished without a resolved protocol document.');
      }

      try {
        await ingestGuidanceDocument({
          sourceType: 'protocol',
          documentId: protocolId,
          protocolId,
          protocolName: fileName,
          title: fileName,
          storageBucket: 'protocol',
          storagePath: finalizedProtocol.storagePath,
          metadata: {
            source_label: fileName,
          },
        });
        window.alert('Added to Trial Library. Strict disengagement static context is ready. Guidance indexing will continue in the background.');
      } catch (guidanceError) {
        console.error('Protocol guidance indexing trigger failed:', guidanceError);
        await updateDoc(doc(db, 'protocols', protocolId), {
          guidance_index_status: 'error',
          guidance_index_error: guidanceError.message || 'Guidance indexing could not be started automatically.',
          guidance_indexed_at: null,
        });
        window.alert(
          'Added to Trial Library. Strict disengagement static context is ready. Guidance indexing could not be started automatically, but this does not block patient disengagement prediction. Use "Retry guidance index" on this protocol card.'
        );
      }

      setFile(null);
      uploadSucceeded = true;
    } catch (error) {
      console.error(error);
      window.alert(`Upload failed: ${error.message}`);
    } finally {
      setUploading(false);
    }
    return uploadSucceeded;
  };

  const handleExceptionalUpload = async () => {
    const succeeded = await handleUpload(uploadExceptionPhaseOverride);
    if (succeeded) {
      setShowUploadExceptionDialog(false);
      setUploadExceptionPhaseOverride('');
      setUploadExceptionConfirmValue('');
    }
  };

  const handleDelete = async (protocol) => {
    if (!window.confirm(`Delete "${protocol.name}" permanently? This will remove it for all users.`)) {
      return;
    }

    try {
      try {
        await deleteGuidanceDocumentChunks({
          sourceType: 'protocol',
          documentId: protocol.id,
          protocolId: protocol.id,
        });
      } catch (guidanceCleanupError) {
        console.error('Guidance chunk cleanup failed during protocol delete:', guidanceCleanupError);
      }

      try {
        const [{ error: patientReviewDeleteError }, { error: trialReviewDeleteError }] = await Promise.all([
          supabase.from('epro_patient_daily_review').delete().eq('trial_id', protocol.id),
          supabase.from('epro_trial_daily_review').delete().eq('trial_id', protocol.id),
        ]);
        if (patientReviewDeleteError) {
          throw patientReviewDeleteError;
        }
        if (trialReviewDeleteError) {
          throw trialReviewDeleteError;
        }
      } catch (eproCleanupError) {
        console.error('ePRO review cleanup failed during protocol delete:', eproCleanupError);
      }

      const usersQuery = query(collection(db, 'users'), where('protocolId', '==', protocol.id));
      const usersSnapshot = await getDocs(usersQuery);

      await Promise.all(
        usersSnapshot.docs.map((userDoc) =>
          updateDoc(doc(db, 'users', userDoc.id), {
            protocolName: null,
            protocolId: null,
            protocolUrl: null,
            protocolStatus: null,
            protocolAssignedAt: null,
            monitoredVitals: [],
            subject_id: null,
            ...buildPatientDropoutTrialFields(null),
          })
        )
      );

      await deleteDoc(doc(db, 'protocols', protocol.id));

      const { error: storageError } = await supabase.storage.from('protocol').remove([protocol.storagePath]);
      if (storageError) {
        console.error('Supabase Storage Error:', storageError);
        window.alert('Removed from list, but failed to delete the PDF from storage.');
      }
    } catch (error) {
      window.alert(`Delete failed: ${error.message}`);
    }
  };

  const handleRetryGuidanceIndex = async (protocol) => {
    try {
      await updateDoc(doc(db, 'protocols', protocol.id), {
        guidance_index_status: 'indexing',
        guidance_index_error: null,
        guidance_indexed_at: null,
      });

      await ingestGuidanceDocument({
        sourceType: 'protocol',
        documentId: protocol.id,
        protocolId: protocol.id,
        protocolName: protocol.name,
        title: protocol.name,
        storageBucket: 'protocol',
        storagePath: protocol.storagePath,
        metadata: {
          source_label: protocol.name,
        },
      });

      window.alert('Guidance indexing re-triggered successfully.');
    } catch (error) {
      console.error('Guidance indexing retry failed:', error);
      await updateDoc(doc(db, 'protocols', protocol.id), {
        guidance_index_status: 'error',
        guidance_index_error: error.message,
      });
      window.alert(`Guidance indexing retry failed: ${error.message}`);
    }
  };

  const handlePreview = async (protocol) => {
    if (!protocol.storagePath) {
      window.alert('Error: Protocol path missing.');
      return;
    }

    const newTab = window.open('', '_blank');
    if (!newTab) {
      window.alert('Please allow popups for this site to view the PDF.');
      return;
    }

    newTab.document.write('Loading document...');

    try {
      const { data, error } = await supabase.storage.from('protocol').createSignedUrl(protocol.storagePath, 60);
      if (error) throw error;
      if (data?.signedUrl) {
        newTab.location.href = data.signedUrl;
      } else {
        newTab.close();
        window.alert('Unable to generate link.');
      }
    } catch (error) {
      console.error('Preview Error:', error);
      newTab.close();
      window.alert(`Could not open file: ${error.message}`);
    }
  };

  const updateDraft = (protocolId, updater) => {
    setDrafts((current) => {
      const baseDraft = current[protocolId] || buildDraft(protocols.find((entry) => entry.id === protocolId) || {});
      return {
        ...current,
        [protocolId]: updater(baseDraft),
      };
    });
    setProtocolSaveFeedbackById((current) => {
      if (!current[protocolId]) {
        return current;
      }
      return {
        ...current,
        [protocolId]: null,
      };
    });
  };

  const handlePolicyFieldChange = (protocolId, severity, field, value) => {
    updateDraft(protocolId, (baseDraft) => ({
      ...baseDraft,
      notification_policy: {
        ...baseDraft.notification_policy,
        [severity]: {
          ...baseDraft.notification_policy[severity],
          [field]: field === 'due_value' ? value.replace(/[^0-9]/g, '') : value,
        },
      },
    }));
  };

  const handleVitalFieldChange = (protocolId, templateIndex, field, value) => {
    updateDraft(protocolId, (baseDraft) => {
      const nextTemplates = [...baseDraft.vital_templates];
      nextTemplates[templateIndex] = {
        ...nextTemplates[templateIndex],
        [field]: value,
      };
      return {
        ...baseDraft,
        vital_templates: nextTemplates,
      };
    });
  };

  const handleThresholdChange = (protocolId, templateIndex, field, value) => {
    updateDraft(protocolId, (baseDraft) => {
      const nextTemplates = [...baseDraft.vital_templates];
        const nextTemplate = { ...nextTemplates[templateIndex] };
        nextTemplate.thresholds = {
          ...(nextTemplate.thresholds || {}),
          [field]: value.replace(/[^0-9.-]/g, ''),
        };
      nextTemplates[templateIndex] = nextTemplate;
      return {
        ...baseDraft,
        vital_templates: nextTemplates,
      };
    });
  };

  const handleRemoveVital = (protocolId, templateIndex) => {
    updateDraft(protocolId, (baseDraft) => ({
      ...baseDraft,
      vital_templates: baseDraft.vital_templates.filter((_, index) => index !== templateIndex),
    }));
  };

  const handleAddBuiltinVital = (protocolId) => {
    const builtinKey = builtinSelections[protocolId];
    if (!builtinKey) return;
    const template = findBuiltinVitalTemplate(builtinKey);
    if (!template) return;

    updateDraft(protocolId, (baseDraft) => {
      const alreadyExists = baseDraft.vital_templates.some((entry) => entry.key === template.key);
      if (alreadyExists) return baseDraft;
      return {
        ...baseDraft,
        vital_templates: [...baseDraft.vital_templates, template],
      };
    });

    setBuiltinSelections((current) => ({
      ...current,
      [protocolId]: '',
    }));
  };

  const handleAddCustomVital = (protocolId) => {
    const label = window.prompt('Custom vital label');
    if (!label) return;
    const unit = window.prompt('Unit (optional)', '') || '';

    updateDraft(protocolId, (baseDraft) => ({
      ...baseDraft,
      vital_templates: [
        ...baseDraft.vital_templates,
        {
          key: label,
          label,
          unit,
          input_type: 'numeric',
          storage_key: label,
          thresholds: {},
        },
      ],
    }));
  };

  const handleSaveProtocol = async (protocolId) => {
    const protocol = protocols.find((entry) => entry.id === protocolId) || {};
    const draft = drafts[protocolId] || buildDraft(protocol);
    const staticContextStatus = getProtocolStaticContextStatus(protocol);
    const dropoutTrialFieldStatus = buildDropoutTrialFieldStatus(protocol, draft.dropout_trial_id);
    if (dropoutTrialFieldStatus.blocking) {
      setProtocolSaveFeedbackById((current) => ({
        ...current,
        [protocolId]: {
          tone: 'danger',
          message: `Save blocked. ${dropoutTrialFieldStatus.message}`,
        },
      }));
      return;
    }

    setSavingProtocolId(protocolId);
    try {
      const normalizedTemplates = coerceVitalTemplates(draft.vital_templates);
      const notificationPolicy = normalizePolicyForSave(draft.notification_policy);

      await updateDoc(doc(db, 'protocols', protocolId), {
        notification_policy: notificationPolicy,
        vital_templates: normalizedTemplates,
        monitoredVitals: buildFallbackMonitoredVitals(normalizedTemplates),
        updatedAt: new Date().toISOString(),
      });

      const assignedUsersQuery = query(collection(db, 'users'), where('protocolId', '==', protocolId));
      const assignedUsersSnapshot = await getDocs(assignedUsersQuery);

      await Promise.all(
        assignedUsersSnapshot.docs.map((userDoc) =>
          updateDoc(userDoc.ref, {
            monitoredVitals: buildFallbackMonitoredVitals(normalizedTemplates),
          })
        )
      );

      const normalizedDraftTrialId = String(draft.dropout_trial_id || '').trim();
      const dropoutTrialResult = normalizedDraftTrialId
        ? await configureProtocolDropoutTrial({
            protocolId,
            trialId: normalizedDraftTrialId,
          })
        : staticContextStatus.ready
          ? await reconcileProtocolDropoutTrialBinding({ protocolId })
          : await configureProtocolDropoutTrial({
              protocolId,
              trialId: '',
            });

      if (dropoutTrialResult?.dropout_trial_status === 'configured') {
        setProtocolSaveFeedbackById((current) => ({
          ...current,
          [protocolId]: {
            tone: 'success',
            message: 'Trial template saved and disengagement trial binding verified.',
          },
        }));
      } else if (dropoutTrialResult?.dropout_trial_match_status === 'no_supported_trial_detected') {
        setProtocolSaveFeedbackById((current) => ({
          ...current,
          [protocolId]: {
            tone: 'warning',
            message:
              dropoutTrialResult?.dropout_trial_match_message ||
              'Trial template saved. Strict static context is ready, but no supported disengagement dataset trial ID was detected in the stored PDF.',
          },
        }));
      } else if (dropoutTrialResult?.dropout_trial_match_status === 'multiple_supported_trials_detected') {
        setProtocolSaveFeedbackById((current) => ({
          ...current,
          [protocolId]: {
            tone: 'warning',
            message:
              dropoutTrialResult?.dropout_trial_match_message ||
              'Trial template saved. Strict static context is ready, but multiple supported disengagement dataset trial IDs were detected in the stored PDF.',
          },
        }));
      } else if (dropoutTrialResult?.dropout_trial_status === 'not_configured') {
        setProtocolSaveFeedbackById((current) => ({
          ...current,
          [protocolId]: {
            tone: 'success',
            message:
              'Trial template saved. This protocol is currently out of disengagement prediction until a supported dataset trial ID is configured.',
          },
        }));
      } else {
        setProtocolSaveFeedbackById((current) => ({
          ...current,
          [protocolId]: {
            tone: 'success',
            message: 'Trial template saved.',
          },
        }));
      }
    } catch (error) {
      setProtocolSaveFeedbackById((current) => ({
        ...current,
        [protocolId]: {
          tone: 'danger',
          message: error.message || 'Failed to save trial template.',
        },
      }));
    } finally {
      setSavingProtocolId(null);
    }
  };

  const toggleProtocolExpansion = (protocolId) => {
    setExpandedProtocolId((current) => (current === protocolId ? null : protocolId));
  };

  return (
    <div className="protocol-library">
      <div className="card workspace-card">
        <div className="section-header protocol-library__uploadHeader">
          <div className="protocol-library__toolbar">
            <input type="file" accept="application/pdf" onChange={(event) => setFile(event.target.files[0] || null)} />
            <button onClick={() => handleUpload('')} disabled={!file || uploading} className="btn btn-primary btn-small">
              {uploading ? 'Uploading...' : 'Upload PDF'}
            </button>
          </div>
        </div>
        <div className="section-note section-note--spaced">
          After strict static-context extraction succeeds, TrialLight automatically looks for a unique supported `NCT...`
          trial ID in the PDF text and binds it to the disengagement dataset field when there is exactly one match.
        </div>
        <div className="section-note">
          Need a one-time disengagement phase exception for a blocked upload?{' '}
          <button
            type="button"
            onClick={() => setShowUploadExceptionDialog(true)}
            disabled={!file || uploading}
            style={{
              border: 0,
              background: 'transparent',
              color: 'var(--brand-700, #0f4c81)',
              fontWeight: 600,
              cursor: !file || uploading ? 'not-allowed' : 'pointer',
              padding: 0,
              textDecoration: 'underline',
            }}
          >
            Open advanced exception
          </button>
        </div>

        <div className="protocol-library__summaryGrid">
          <div className="workspace-summary-item">
            <span>Total protocols</span>
            <strong>{protocols.length}</strong>
          </div>
          <div className="workspace-summary-item">
            <span>Patients on protocol</span>
            <strong>{assignedProtocolCount}</strong>
          </div>
          <div className="workspace-summary-item">
            <span>Selected patient</span>
            <strong>{selectedPatient?.nickname || 'None selected'}</strong>
          </div>
          <div className="workspace-summary-item">
            <span>Current trial</span>
            <strong>{selectedPatient?.protocolName || 'Not assigned'}</strong>
          </div>
        </div>
      </div>

      {protocols.length ? (
        <div className="protocol-library__stack">
          {protocols.map((protocol) => {
            const draft = drafts[protocol.id] || buildDraft(protocol);
            const isActive = selectedPatient?.protocolId === protocol.id;
            const usageCount = usageCounts[protocol.id] || 0;
            const isExpanded = expandedProtocolId === protocol.id;
            const dropoutTrialFieldStatus = buildDropoutTrialFieldStatus(protocol, draft.dropout_trial_id);
            const staticContextStatus = getProtocolStaticContextStatus(protocol);
            const protocolSaveFeedback = protocolSaveFeedbackById[protocol.id] || null;
            const assignmentBlockedReason = buildProtocolAssignmentBlockReason(protocol);

            return (
              <section
                key={protocol.id}
                className={`card workspace-card protocol-library__card ${isActive ? 'protocol-library__card--active' : ''}`}
              >
                <div className="protocol-library__cardHeader">
                  <div>
                    <div className="protocol-library__templateMeta">
                      <span className="dashboard-kicker">Trial template</span>
                      <span className="metric-pill">{usageCount} patient{usageCount === 1 ? '' : 's'} assigned</span>
                      {isActive ? <span className="metric-pill metric-pill--selected">Selected patient active</span> : null}
                    </div>
                    <h3 className="mt-0">{protocol.name}</h3>
                    <div className="section-note">
                      Uploaded {protocol.uploadedAt ? new Date(protocol.uploadedAt).toLocaleString() : 'Unknown time'}
                    </div>
                    <div className="patient-config__pillWrap" style={{ marginTop: '10px' }}>
                      <span className={`metric-pill metric-pill--${staticContextStatus.tone}`}>
                        {staticContextStatus.label}
                      </span>
                    </div>
                    <div className="section-note section-note--spaced">{staticContextStatus.message}</div>
                    {staticContextStatus.extractedAt ? (
                      <div className="section-note">
                        Last extracted: {formatOptionalDate(staticContextStatus.extractedAt)}
                      </div>
                    ) : null}
                    <div className="section-note section-note--spaced">{formatGuidanceIndexStatus(protocol)}</div>
                <div className="section-note">This index lets Adverse Event Guidance search protocol content quickly.</div>
                  </div>

                  <div className="protocol-library__cardActions">
                    <button
                      type="button"
                      onClick={() => toggleProtocolExpansion(protocol.id)}
                      className="btn btn-secondary btn-small"
                    >
                      {isExpanded ? 'Collapse' : 'Expand'}
                    </button>
                    <button onClick={() => handlePreview(protocol)} className="btn btn-secondary btn-small">
                      Preview PDF
                    </button>
                    <button
                      onClick={() => handleSaveProtocol(protocol.id)}
                      className="btn btn-primary btn-small"
                      disabled={savingProtocolId === protocol.id || dropoutTrialFieldStatus.blocking}
                    >
                      {savingProtocolId === protocol.id ? 'Saving...' : 'Save template'}
                    </button>
                    <button
                      onClick={() => handleRetryGuidanceIndex(protocol)}
                      className="btn btn-secondary btn-small"
                      disabled={!protocol.storagePath}
                    >
                      Retry guidance index
                    </button>
                    <button onClick={() => handleDelete(protocol)} className="btn btn-danger btn-small">
                      Delete
                    </button>
                  </div>
                </div>

                {isExpanded ? (
                  <div className="protocol-library__layout">
                    <div className="protocol-library__main">
                      <div className="info-banner protocol-library__metaCard">
                        <TemplateField label="Optional disengagement dataset trial ID">
                          <input
                            value={draft.dropout_trial_id}
                            onChange={(event) =>
                              updateDraft(protocol.id, (baseDraft) => ({
                                ...baseDraft,
                                dropout_trial_id: event.target.value,
                              }))
                            }
                            placeholder="Optional testing dataset trial ID"
                          />
                          <div className="section-note section-note--spaced">
                            Keep this visible for CRC transparency. TrialLight now auto-binds this field only when the PDF text contains exactly one supported `NCT...` dataset trial ID. Manual save is still blocked unless strict static context is ready and the trial ID is supported.
                          </div>
                          <div className="patient-config__pillWrap" style={{ marginTop: '10px' }}>
                            <span className={`metric-pill metric-pill--${dropoutTrialFieldStatus.tone}`}>
                              {dropoutTrialFieldStatus.label}
                            </span>
                            {dropoutTrialFieldStatus.poolSize ? (
                              <span className="metric-pill">{dropoutTrialFieldStatus.poolSize} canonical subjects</span>
                            ) : null}
                            {dropoutTrialFieldStatus.modelVersion ? (
                              <span className="metric-pill">{dropoutTrialFieldStatus.modelVersion}</span>
                            ) : null}
                          </div>
                          <div className="section-note section-note--spaced">{dropoutTrialFieldStatus.message}</div>
                          {dropoutTrialFieldStatus.lastVerifiedAt ? (
                            <div className="section-note">Last verified: {formatOptionalDate(dropoutTrialFieldStatus.lastVerifiedAt)}</div>
                          ) : null}
                          {dropoutTrialFieldStatus.blocking ? (
                            <div className="field-error">
                              Saving is blocked until this disengagement dataset trial ID is valid, supported, and ready.
                            </div>
                          ) : null}
                          {protocolSaveFeedback?.message ? (
                            protocolSaveFeedback.tone === 'danger' ? (
                              <div className="field-error">{protocolSaveFeedback.message}</div>
                            ) : (
                              <div className="section-note section-note--spaced">{protocolSaveFeedback.message}</div>
                            )
                          ) : null}
                        </TemplateField>
                      </div>

                      {!isProtocolFullyConfiguredForDisengagement(protocol) ? (
                        <div className="info-banner protocol-library__metaCard">
                          <strong>Patient assignment is blocked</strong>
                          <div className="section-note section-note--spaced">{assignmentBlockedReason}</div>
                        </div>
                      ) : null}

                      <div className="info-banner protocol-library__metaCard">
                        <div className="section-header section-header--tight">
                          <div>
                            <strong>Vital templates</strong>
                            <div className="section-note section-note--spaced">
                              Trial-linked monitored vitals and threshold rules. Built-in vitals keep their correct input type automatically.
                            </div>
                          </div>
                          <div className="protocol-library__inlineActions">
                            <select
                              value={builtinSelections[protocol.id] || ''}
                              onChange={(event) =>
                                setBuiltinSelections((current) => ({
                                  ...current,
                                  [protocol.id]: event.target.value,
                                }))
                              }
                            >
                              <option value="">Choose built-in vital</option>
                              {builtinVitals.map((vital) => (
                                <option key={vital.key} value={vital.key}>
                                  {vital.label}
                                </option>
                              ))}
                            </select>
                            <button onClick={() => handleAddBuiltinVital(protocol.id)} className="btn btn-secondary btn-small">
                              Add built-in
                            </button>
                            <button onClick={() => handleAddCustomVital(protocol.id)} className="btn btn-secondary btn-small">
                              Add custom
                            </button>
                          </div>
                        </div>

                        <div className="protocol-library__templateStack">
                          {draft.vital_templates.length ? (
                            draft.vital_templates.map((template, templateIndex) => {
                              const builtinTemplate = isBuiltinVitalTemplate(template, template.key) ? findBuiltinVitalTemplate(template.key || template.storage_key || template.label) : null;
                              const lockedInputType = builtinTemplate?.input_type || 'numeric';
                              return (
                                <div
                                  key={`${protocol.id}-${template.key}-${templateIndex}`}
                                  className="protocol-library__templateCard"
                                >
                                  <div className="protocol-library__templateTop">
                                    <TemplateField label="Label">
                                      <input
                                        value={template.label}
                                        onChange={(event) =>
                                          handleVitalFieldChange(protocol.id, templateIndex, 'label', event.target.value)
                                        }
                                        placeholder="e.g. SpO2"
                                      />
                                    </TemplateField>

                                    <TemplateField label="Unit">
                                      <input
                                        value={template.unit}
                                        onChange={(event) =>
                                          handleVitalFieldChange(protocol.id, templateIndex, 'unit', event.target.value)
                                        }
                                        placeholder="e.g. %"
                                      />
                                    </TemplateField>

                                    <TemplateField label="Input type">
                                      <div className="protocol-library__lockedValue">
                                        <strong>{lockedInputType === 'blood_pressure' ? 'Blood pressure' : 'Numeric'}</strong>
                                        <span>{builtinTemplate ? 'Built-in vital' : 'Custom vital'}</span>
                                      </div>
                                    </TemplateField>

                                    <div className="protocol-library__field protocol-library__field--action">
                                      <label className="protocol-library__fieldLabel">Template action</label>
                                      <button
                                        onClick={() => handleRemoveVital(protocol.id, templateIndex)}
                                        className="btn btn-danger btn-small"
                                      >
                                        Remove
                                      </button>
                                    </div>
                                  </div>

                                  {renderThresholdFields(
                                    {
                                      ...template,
                                      input_type: lockedInputType,
                                    },
                                    protocol.id,
                                    templateIndex,
                                    handleThresholdChange
                                  )}
                                </div>
                              );
                            })
                          ) : (
                            <div className="empty-panel">No vital templates yet. Add a built-in vital or create a custom one.</div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="protocol-library__policyColumn">
                      <div className="info-banner protocol-library__metaCard">
                        <div className="section-header section-header--tight">
                          <div>
                            <strong>Notification policy</strong>
                            <div className="section-note section-note--spaced">
                  Define how CRC follow-up timing behaves for mild, moderate, and serious adverse events.
                            </div>
                          </div>
                        </div>

                        <div className="protocol-library__policyGrid">
                          {POLICY_FIELDS.map((severity) => (
                            <div key={severity} className={`protocol-library__policyCard protocol-library__policyCard--${severity}`}>
                              <div className="protocol-library__policyTitle">{severity}</div>

                              <TemplateField label="Due value">
                                <input
                                  value={draft.notification_policy[severity].due_value}
                                  onChange={(event) =>
                                    handlePolicyFieldChange(protocol.id, severity, 'due_value', event.target.value)
                                  }
                                  placeholder="1"
                                />
                              </TemplateField>

                              <TemplateField label="Due unit">
                                <select
                                  value={draft.notification_policy[severity].due_unit}
                                  onChange={(event) =>
                                    handlePolicyFieldChange(protocol.id, severity, 'due_unit', event.target.value)
                                  }
                                >
                                  {DUE_UNITS.map((unit) => (
                                    <option key={unit} value={unit}>
                                      {unit}
                                    </option>
                                  ))}
                                </select>
                              </TemplateField>

                              <TemplateField label="Instruction">
                                <textarea
                                  rows={3}
                                  value={draft.notification_policy[severity].instruction}
                                  onChange={(event) =>
                                    handlePolicyFieldChange(protocol.id, severity, 'instruction', event.target.value)
                                  }
                                  onInput={handleTextareaAutoGrow}
                                  className="protocol-library__textarea"
                                  placeholder="Instruction"
                                />
                              </TemplateField>

                              <TemplateField label="Action code">
                                <textarea
                                  rows={3}
                                  value={draft.notification_policy[severity].action_code}
                                  onChange={(event) =>
                                    handlePolicyFieldChange(protocol.id, severity, 'action_code', event.target.value)
                                  }
                                  onInput={handleTextareaAutoGrow}
                                  className="protocol-library__textarea"
                                  placeholder="Action code"
                                />
                              </TemplateField>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="card workspace-card">
          <div className="empty-panel">No protocols found yet. Upload the first clinical trial PDF to get started.</div>
        </div>
      )}

      {showUploadExceptionDialog ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            zIndex: 2000,
          }}
        >
          <div
            className="card workspace-card"
            style={{ width: 'min(640px, 100%)', maxHeight: '90vh', overflowY: 'auto' }}
          >
            <div className="section-header">
              <div>
                <h3>Advanced exception upload</h3>
                <div className="section-note">
                  This does not rewrite the PDF. It only changes the disengagement model phase used for this single upload.
                </div>
              </div>
            </div>

            <div className="info-banner">
              <TemplateField label="One-time disengagement phase exception">
                <select
                  value={uploadExceptionPhaseOverride}
                  onChange={(event) => setUploadExceptionPhaseOverride(event.target.value)}
                  disabled={uploading}
                >
                  <option value="">Choose exception phase</option>
                  <option value="phase 0">Force disengagement early phase 1</option>
                  <option value="phase 1">Force disengagement phase 1</option>
                  <option value="phase 2">Force disengagement phase 2</option>
                </select>
              </TemplateField>

              <div className="section-note section-note--spaced">
                This path is intended only for one-time operator exceptions. The override is backend-audited and is cleared after upload.
              </div>

              <TemplateField label="Type ALLOW EXCEPTION to continue">
                <input
                  value={uploadExceptionConfirmValue}
                  onChange={(event) => setUploadExceptionConfirmValue(event.target.value)}
                  placeholder="ALLOW EXCEPTION"
                />
              </TemplateField>
            </div>

            <div className="protocol-library__cardActions" style={{ marginTop: '16px' }}>
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={() => {
                  setShowUploadExceptionDialog(false);
                  setUploadExceptionPhaseOverride('');
                  setUploadExceptionConfirmValue('');
                }}
                disabled={uploading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary btn-small"
                onClick={handleExceptionalUpload}
                disabled={
                  !file ||
                  uploading ||
                  !uploadExceptionPhaseOverride ||
                  uploadExceptionConfirmValue.trim().toUpperCase() !== 'ALLOW EXCEPTION'
                }
              >
                {uploading ? 'Uploading...' : 'Upload with exception'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default ProtocolManager;
