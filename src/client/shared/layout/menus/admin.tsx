import { Translate, translate } from 'app/shared/jhipster/language';
import MenuItem from 'app/shared/layout/menus/menu-item';
import { NavDropdown } from './menu-components';
export const AdminMenu = () => (
  <NavDropdown icon="users-cog" name={translate('global.menu.admin.main')} id="admin-menu" data-cy="adminMenu">
    <MenuItem icon="users" to="/admin/user-management">
      <Translate contentKey="global.menu.admin.userManagement" />
    </MenuItem>
    <MenuItem icon="heart" to="/admin/health">
      <Translate contentKey="global.menu.admin.health" />
    </MenuItem>
    <MenuItem icon="cogs" to="/admin/operations">
      <Translate contentKey="cloudflare.operations" />
    </MenuItem>
  </NavDropdown>
);
