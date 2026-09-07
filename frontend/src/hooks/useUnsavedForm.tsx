import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Modal, type FormInstance } from "antd";
import { useBlocker } from "react-router-dom";
import { apiErrorMessage } from "@/api/client";
import { useNavigation } from "@/context/NavigationContext";
import { useI18n } from "@/i18n";

/** A saved snapshot, rather than touched fields, determines whether a draft is dirty. */
export function useUnsavedForm<T extends Record<string, string>>({ form, emptyValues, onSave }: {
  form: FormInstance<T>;
  emptyValues: T;
  onSave: (values: T) => Promise<void>;
}) {
  const { t } = useI18n();
  const { registerLeaveGuard } = useNavigation();
  const baseline = useRef<T>({ ...emptyValues });
  const dirtyRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const saveHandler = useRef(onSave);
  saveHandler.current = onSave;
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [saveError, setSaveError] = useState("");
  const leaveRequest = useRef<{ promise: Promise<boolean>; resolve: (leave: boolean) => void } | null>(null);

  const refreshDirty = useCallback(() => {
    const values = form.getFieldsValue(true);
    const next = Object.keys(baseline.current).some(key => (values[key] ?? "") !== baseline.current[key]);
    dirtyRef.current = next;
    setDirty(next);
  }, [form]);

  const initialize = useCallback((values: T) => {
    baseline.current = { ...values };
    form.setFieldsValue(values as Parameters<typeof form.setFieldsValue>[0]);
    dirtyRef.current = false;
    setDirty(false);
  }, [form]);

  const save = useCallback((): Promise<boolean> => {
    if (inFlight.current) return inFlight.current;
    setSaving(true);
    setSaveError("");
    const operation = (async () => {
      let values: T;
      try { values = await form.validateFields(); }
      catch { setSaveError(t("form_leave_validation")); return false; }
      try {
        await saveHandler.current(values);
        baseline.current = { ...values };
        refreshDirty();
        return !dirtyRef.current;
      } catch (error) {
        setSaveError(apiErrorMessage(error));
        return false;
      }
    })().finally(() => { inFlight.current = null; setSaving(false); });
    inFlight.current = operation;
    return operation;
  }, [form, refreshDirty, t]);

  const beforeLeave = useCallback(async () => {
    // An active submit must finish before either router navigation or logout proceeds.
    if (inFlight.current && !(await inFlight.current)) return false;
    if (!dirtyRef.current) return true;
    if (leaveRequest.current) return leaveRequest.current.promise;
    let resolve!: (leave: boolean) => void;
    const promise = new Promise<boolean>(result => { resolve = result; });
    leaveRequest.current = { promise, resolve };
    setSaveError("");
    setLeaveOpen(true);
    return promise;
  }, []);

  const finishLeave = useCallback((leave: boolean) => {
    if (leave) { dirtyRef.current = false; setDirty(false); }
    setLeaveOpen(false);
    leaveRequest.current?.resolve(leave);
    leaveRequest.current = null;
  }, []);

  useEffect(() => registerLeaveGuard(beforeLeave), [registerLeaveGuard, beforeLeave]);
  useEffect(() => () => { leaveRequest.current?.resolve(false); }, []);
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search) &&
    (dirtyRef.current || Boolean(inFlight.current))
  );
  const navigationPending = useRef(false);
  useEffect(() => {
    if (blocker.state !== "blocked" || navigationPending.current) return;
    navigationPending.current = true;
    void beforeLeave().then(canLeave => {
      if (canLeave) blocker.proceed();
      else blocker.reset();
    }).finally(() => { navigationPending.current = false; });
  }, [blocker, beforeLeave]);

  useEffect(() => {
    const guardUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current && !inFlight.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guardUnload);
    return () => window.removeEventListener("beforeunload", guardUnload);
  }, []);

  const leaveDialog = <Modal open={leaveOpen} title={t("form_leave_title")} closable={!saving}
    mask={{ closable: false }} keyboard={!saving} onCancel={() => finishLeave(false)}
    footer={<div className="novel-leave-actions">
      <Button disabled={saving} onClick={() => finishLeave(false)}>{t("form_leave_stay")}</Button>
      <Button disabled={saving} onClick={() => finishLeave(true)}>{t("form_leave_discard")}</Button>
      <Button type="primary" loading={saving} onClick={async () => { if (await save()) finishLeave(true); }}>{t("form_leave_save")}</Button>
    </div>}>
    <p>{t("form_leave_description")}</p>
    {saveError && <Alert type="error" showIcon title={saveError} />}
  </Modal>;

  const saveAndContinue = async (onSaved: () => void) => {
    if (await save()) {
      // If the user chose a different destination during the request, let the
      // router complete that destination instead of returning to the list.
      if (!navigationPending.current && !leaveRequest.current) onSaved();
    }
  };
  return { dirty, saving, initialize, refreshDirty, save, saveAndContinue, leaveDialog };
}
