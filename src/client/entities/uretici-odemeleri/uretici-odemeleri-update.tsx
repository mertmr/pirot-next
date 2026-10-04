import React, { useEffect, useMemo } from 'react';
import Button from 'react-bootstrap/Button';
import Col from 'react-bootstrap/Col';
import Row from 'react-bootstrap/Row';
import { Translate, ValidatedField, ValidatedForm, translate } from 'react-jhipster';
import { Link, useNavigate, useParams } from 'app/shared/routing/navigation';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

import { useAppDispatch, useAppSelector } from 'app/config/store';
import { getEntities as getUreticis } from 'app/entities/uretici/uretici.reducer';
import { convertDateTimeFromServer, convertDateTimeToServer, displayDefaultDateTime } from 'app/shared/util/date-utils';

import { createEntity, getEntity, reset, updateEntity } from './uretici-odemeleri.reducer';
import { isEntityFormReady } from 'app/shared/util/entity-form';

export const UreticiOdemeleriUpdate = () => {
  const dispatch = useAppDispatch();

  const navigate = useNavigate();

  const { id } = useParams<'id'>();
  const isNew = id === undefined;

  const ureticis = useAppSelector(state => state.uretici.entities);
  const ureticiOdemeleriEntity = useAppSelector(state => state.ureticiOdemeleri.entity);
  const formReady = isEntityFormReady(ureticiOdemeleriEntity, id, isNew);
  const updating = useAppSelector(state => state.ureticiOdemeleri.updating);
  const updateSuccess = useAppSelector(state => state.ureticiOdemeleri.updateSuccess);

  const handleClose = () => {
    navigate(`/uretici-odemeleri${location.search}`);
  };

  useEffect(() => {
    if (isNew) {
      dispatch(reset());
    } else {
      dispatch(getEntity(id));
    }

    dispatch(getUreticis({}));
  }, []);

  useEffect(() => {
    if (updateSuccess) {
      handleClose();
    }
  }, [updateSuccess]);

  const saveEntity = values => {
    if (values.id !== undefined && typeof values.id !== 'number') {
      values.id = Number(values.id);
    }
    values.sonGuncellenmeTarihi = convertDateTimeToServer(values.sonGuncellenmeTarihi);

    const entity = {
      ...ureticiOdemeleriEntity,
      ...values,
      uretici: ureticis.find(it => it.id?.toString() === values.uretici?.toString()),
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
            sonGuncellenmeTarihi: displayDefaultDateTime(),
          }
        : {
            ...ureticiOdemeleriEntity,
            sonGuncellenmeTarihi: convertDateTimeFromServer(ureticiOdemeleriEntity.sonGuncellenmeTarihi),
            uretici: ureticiOdemeleriEntity?.uretici?.id,
          },
    [isNew, ureticiOdemeleriEntity],
  );

  return (
    <div>
      <Row className="justify-content-center">
        <Col md="8">
          <h2 id="koopApp.ureticiOdemeleri.home.createOrEditLabel" data-cy="UreticiOdemeleriCreateUpdateHeading">
            <Translate contentKey="koopApp.ureticiOdemeleri.home.createOrEditLabel">Create or edit a UreticiOdemeleri</Translate>
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
                <ValidatedField
                  name="id"
                  required
                  readOnly
                  id="uretici-odemeleri-id"
                  label={translate('global.field.id')}
                  validate={{ required: true }}
                />
              )}
              <ValidatedField
                label={translate('koopApp.ureticiOdemeleri.tutar')}
                id="uretici-odemeleri-tutar"
                name="tutar"
                data-cy="tutar"
                type="text"
              />
              <ValidatedField
                label={translate('koopApp.ureticiOdemeleri.sonGuncellenmeTarihi')}
                id="uretici-odemeleri-sonGuncellenmeTarihi"
                name="sonGuncellenmeTarihi"
                data-cy="sonGuncellenmeTarihi"
                type="datetime-local"
                placeholder="YYYY-MM-DD HH:mm"
              />
              <ValidatedField
                id="uretici-odemeleri-uretici"
                name="uretici"
                data-cy="uretici"
                label={translate('koopApp.ureticiOdemeleri.uretici')}
                type="select"
              >
                <option value="" key="0" />
                {ureticis
                  ? ureticis.map(otherEntity => (
                      <option value={otherEntity.id} key={otherEntity.id}>
                        {otherEntity.id}
                      </option>
                    ))
                  : null}
              </ValidatedField>
              <Button as={Link as any} id="cancel-save" data-cy="entityCreateCancelButton" to="/uretici-odemeleri" replace variant="info">
                <FontAwesomeIcon icon="arrow-left" />
                &nbsp;
                <span className="d-none d-md-inline">
                  <Translate contentKey="entity.action.back">Back</Translate>
                </span>
              </Button>
              &nbsp;
              <Button variant="primary" id="save-entity" data-cy="entityCreateSaveButton" type="submit" disabled={updating}>
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

export default UreticiOdemeleriUpdate;
