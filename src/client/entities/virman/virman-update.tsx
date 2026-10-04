import React, { useEffect, useState, useMemo } from 'react';
import { CorrectionFields } from 'app/shared/financial/nobet-correction';
import { IDuzeltmeTalebi } from 'app/shared/model/nobet-duzeltme.model';
import Button from 'react-bootstrap/Button';
import Col from 'react-bootstrap/Col';
import Row from 'react-bootstrap/Row';
import { Translate, ValidatedField, ValidatedForm, isNumber, translate } from 'react-jhipster';
import { Link, useNavigate, useParams } from 'app/shared/routing/navigation';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

import { useAppDispatch, useAppSelector } from 'app/config/store';
import { getUsers } from 'app/modules/administration/user-management/user-management.reducer';
import { Hesap } from 'app/shared/model/enumerations/hesap.model';
import { convertDateTimeFromServer, convertDateTimeToServer, displayDefaultDateTime } from 'app/shared/util/date-utils';

import { createEntity, getEntity, reset, updateEntity } from './virman.reducer';
import { isEntityFormReady } from 'app/shared/util/entity-form';

export const VirmanUpdate = () => {
  const [closed, setClosed] = useState(false);
  const [duzeltme, setDuzeltme] = useState<IDuzeltmeTalebi>();
  const [correctionBlocked, setCorrectionBlocked] = useState(true);
  const dispatch = useAppDispatch();

  const navigate = useNavigate();

  const { id } = useParams<'id'>();
  const isNew = id === undefined;

  const users = useAppSelector(state => state.userManagement.users);
  const virmanEntity = useAppSelector(state => state.virman.entity);
  const formReady = isEntityFormReady(virmanEntity, id, isNew);
  const updating = useAppSelector(state => state.virman.updating);
  const updateSuccess = useAppSelector(state => state.virman.updateSuccess);
  const hesapValues = Object.keys(Hesap);

  const handleClose = () => {
    navigate(`/virman${location.search}`);
  };

  useEffect(() => {
    if (isNew) {
      dispatch(reset());
    } else {
      dispatch(getEntity(id));
    }

    dispatch(getUsers({}));
  }, []);

  useEffect(() => {
    if (updateSuccess) {
      handleClose();
    }
  }, [updateSuccess]);

  const saveEntity = values => {
    if (!isNew && correctionBlocked) return;
    if (values.id !== undefined && typeof values.id !== 'number') {
      values.id = Number(values.id);
    }
    values.tarih = convertDateTimeToServer(values.tarih);

    const entity = {
      ...virmanEntity,
      ...values,
      duzeltme,
      user: users.find(it => it.id?.toString() === values.user?.toString()),
    };

    if (isNew) {
      dispatch(createEntity(entity));
    } else {
      dispatch(updateEntity(entity));
    }
  };

  // Memoized identity matters: ValidatedForm resets the form whenever the
  // defaultValues reference changes, so it must not be rebuilt on every render.
  const defaultValues = useMemo(
    () =>
      isNew
        ? {
            tarih: displayDefaultDateTime(),
          }
        : {
            cikisHesabi: 'KASA',
            girisHesabi: 'KASA',
            ...virmanEntity,
            tarih: convertDateTimeFromServer(virmanEntity.tarih),
            user: virmanEntity?.user?.id,
          },
    [isNew, virmanEntity],
  );

  return (
    <div>
      <Row className="justify-content-center">
        <Col md="8">
          <h2 id="koopApp.virman.home.createOrEditLabel" data-cy="VirmanCreateUpdateHeading">
            <Translate contentKey="koopApp.virman.home.createOrEditLabel">Create or edit a Virman</Translate>
          </h2>
        </Col>
      </Row>
      <Row className="justify-content-center">
        <Col md="8">
          {!formReady ? (
            <p>{translate('reports.common.loading')}</p>
          ) : (
            <ValidatedForm defaultValues={defaultValues} onSubmit={saveEntity}>
              {!isNew && (
                <CorrectionFields type="virman" id={id} onChange={setDuzeltme} onBlocked={setCorrectionBlocked} onClosed={setClosed} />
              )}
              {!isNew && (
                <ValidatedField
                  name="id"
                  required
                  readOnly
                  id="virman-id"
                  label={translate('global.field.id')}
                  validate={{ required: true }}
                />
              )}
              <ValidatedField
                label={translate('koopApp.virman.tutar')}
                id="virman-tutar"
                name="tutar"
                data-cy="tutar"
                type="text"
                validate={{
                  required: { value: true, message: translate('entity.validation.required') },
                  validate: v => isNumber(v) || translate('entity.validation.number'),
                }}
              />
              <ValidatedField
                label={translate('koopApp.virman.notlar')}
                id="virman-notlar"
                name="notlar"
                data-cy="notlar"
                type="text"
                validate={{
                  required: { value: true, message: translate('entity.validation.required') },
                }}
              />
              <ValidatedField
                label={translate('koopApp.virman.cikisHesabi')}
                id="virman-cikisHesabi"
                name="cikisHesabi"
                data-cy="cikisHesabi"
                type="select"
              >
                {hesapValues.map(hesap => (
                  <option value={hesap} key={hesap}>
                    {translate(`koopApp.Hesap.${hesap}`)}
                  </option>
                ))}
              </ValidatedField>
              <ValidatedField
                label={translate('koopApp.virman.girisHesabi')}
                id="virman-girisHesabi"
                name="girisHesabi"
                data-cy="girisHesabi"
                type="select"
              >
                {hesapValues.map(hesap => (
                  <option value={hesap} key={hesap}>
                    {translate(`koopApp.Hesap.${hesap}`)}
                  </option>
                ))}
              </ValidatedField>
              <ValidatedField
                label={translate('koopApp.virman.tarih')}
                id="virman-tarih"
                name="tarih"
                data-cy="tarih"
                type="datetime-local"
                disabled={closed}
                placeholder="YYYY-MM-DD HH:mm"
              />
              <ValidatedField id="virman-user" name="user" data-cy="user" label={translate('koopApp.virman.user')} type="select">
                <option value="" key="0" />
                {users
                  ? users.map(otherEntity => (
                      <option value={otherEntity.id} key={otherEntity.id}>
                        {otherEntity.login}
                      </option>
                    ))
                  : null}
              </ValidatedField>
              <Button as={Link as any} id="cancel-save" data-cy="entityCreateCancelButton" to="/virman" replace variant="info">
                <FontAwesomeIcon icon="arrow-left" />
                &nbsp;
                <span className="d-none d-md-inline">
                  <Translate contentKey="entity.action.back">Back</Translate>
                </span>
              </Button>
              &nbsp;
              <Button
                variant="primary"
                id="save-entity"
                data-cy="entityCreateSaveButton"
                type="submit"
                disabled={updating || (!isNew && correctionBlocked)}
              >
                <FontAwesomeIcon icon="save" />
                &nbsp;
                <Translate contentKey="entity.action.save">Save</Translate>
              </Button>
            </ValidatedForm>
          )}
        </Col>
      </Row>
    </div>
  );
};

export default VirmanUpdate;
