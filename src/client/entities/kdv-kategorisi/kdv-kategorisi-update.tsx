import React, { useEffect, useMemo } from 'react';
import Button from 'react-bootstrap/Button';
import Col from 'react-bootstrap/Col';
import Row from 'react-bootstrap/Row';
import { Translate, ValidatedField, ValidatedForm, isNumber, translate } from 'react-jhipster';
import { Link, useNavigate, useParams } from 'app/shared/routing/navigation';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

import { useAppDispatch, useAppSelector } from 'app/config/store';

import { createEntity, getEntity, reset, updateEntity } from './kdv-kategorisi.reducer';
import { isEntityFormReady } from 'app/shared/util/entity-form';

export const KdvKategorisiUpdate = () => {
  const dispatch = useAppDispatch();

  const navigate = useNavigate();

  const { id } = useParams<'id'>();
  const isNew = id === undefined;

  const kdvKategorisiEntity = useAppSelector(state => state.kdvKategorisi.entity);
  const formReady = isEntityFormReady(kdvKategorisiEntity, id, isNew);
  const updating = useAppSelector(state => state.kdvKategorisi.updating);
  const updateSuccess = useAppSelector(state => state.kdvKategorisi.updateSuccess);

  const handleClose = () => {
    navigate(`/kdv-kategorisi${location.search}`);
  };

  useEffect(() => {
    if (isNew) {
      dispatch(reset());
    } else {
      dispatch(getEntity(id));
    }
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
    if (values.kdvOrani !== undefined && typeof values.kdvOrani !== 'number') {
      values.kdvOrani = Number(values.kdvOrani);
    }

    const entity = {
      ...kdvKategorisiEntity,
      ...values,
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
        ? {}
        : {
            ...kdvKategorisiEntity,
          },
    [isNew, kdvKategorisiEntity],
  );

  return (
    <div>
      <Row className="justify-content-center">
        <Col md="8">
          <h2 id="koopApp.kdvKategorisi.home.createOrEditLabel" data-cy="KdvKategorisiCreateUpdateHeading">
            <Translate contentKey="koopApp.kdvKategorisi.home.createOrEditLabel">Create or edit a KdvKategorisi</Translate>
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
                  id="kdv-kategorisi-id"
                  label={translate('global.field.id')}
                  validate={{ required: true }}
                />
              )}
              <ValidatedField
                label={translate('koopApp.kdvKategorisi.kategoriAdi')}
                id="kdv-kategorisi-kategoriAdi"
                name="kategoriAdi"
                data-cy="kategoriAdi"
                type="text"
                validate={{
                  required: { value: true, message: translate('entity.validation.required') },
                }}
              />
              <ValidatedField
                label={translate('koopApp.kdvKategorisi.kdvOrani')}
                id="kdv-kategorisi-kdvOrani"
                name="kdvOrani"
                data-cy="kdvOrani"
                type="text"
                validate={{
                  required: { value: true, message: translate('entity.validation.required') },
                  validate: v => isNumber(v) || translate('entity.validation.number'),
                }}
              />
              <Button as={Link as any} id="cancel-save" data-cy="entityCreateCancelButton" to="/kdv-kategorisi" replace variant="info">
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

export default KdvKategorisiUpdate;
