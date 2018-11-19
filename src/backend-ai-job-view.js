/**
 * Backend.AI-job-view 
 */

import { PolymerElement, html } from '@polymer/polymer';
import '@polymer/polymer/lib/elements/dom-if.js';
import { setPassiveTouchGestures } from '@polymer/polymer/lib/utils/settings';
import '@polymer/paper-icon-button/paper-icon-button';
import '@polymer/paper-styles/typography';
import '@polymer/paper-styles/color';
import '@polymer/paper-material/paper-material';
import '@polymer/iron-icon/iron-icon';
import '@polymer/iron-icons/iron-icons';
import '@polymer/iron-image/iron-image';
import '@polymer/iron-flex-layout/iron-flex-layout';
import '@polymer/iron-flex-layout/iron-flex-layout-classes';

import '@polymer/paper-dialog/paper-dialog';
import '@polymer/paper-button/paper-button';
import '@polymer/neon-animation/animations/scale-up-animation.js';
import '@polymer/neon-animation/animations/fade-out-animation.js';

import './backend-ai-styles.js';
import './backend-ai-job-list.js';

class BackendAIJobView extends PolymerElement {
  static get properties() {
    return {
    };
  }

  constructor() {
    super();
    // Resolve warning about scroll performance 
    // See https://developers.google.com/web/updates/2016/06/passive-event-listeners
    setPassiveTouchGestures(true);
  }

  ready() {
    super.ready();
    this.$['launch-session'].addEventListener('tap', this._newSession.bind(this));
  }
  static get observers() {
    return [
      '_routeChanged(route.*)',
      '_viewChanged(routeData.view)'
    ]
  }
  
  _routeChanged(changeRecord) {
    if (changeRecord.path === 'path') {
      console.log('Path changed!');
    }
  }
  _viewChanged(view) {
    // load data for view
  }
  _newSession() {
    this.$['new-session-dialog'].open();
  }

  static get template() {
    return html`
    <style is="custom-style" include="backend-ai-styles iron-flex iron-flex-alignment iron-positioning">
    </style>
    <paper-material class="item" elevation="1">
        <h3 class="paper-material-title">Jobs</h3>
        <h4 class="horizontal center layout">
          <span>Running</span>
          <paper-button id="launch-session" class="fg red">
            <iron-icon icon="add"></iron-icon>
          Launch</paper-button>
        </h4>
        <div>
            <backend-ai-job-list condition="running"></backend-ai-job-list>
        </div>
        <h4>Finished</h4>
        <div>
            <backend-ai-job-list condition="finished"></backend-ai-job-list>
        </div>

     </paper-material>
     <paper-dialog id="new-session-dialog"
     entry-animation="scale-up-animation" exit-animation="fade-out-animation">
         <paper-material elevation="1" class="login-panel intro centered" style="margin: 0;">
         <h3>Launch session</h3>
         <form id="login-form" onSubmit="this._launchSession()">
         <fieldset>
              Kernel here / resource allocation here
             <br /><br />
             <paper-button class="blue" type="submit"
                     id="login-button">
                 <iron-icon icon="check"></iron-icon>
                 Launch</paper-button>
         </fieldset>
         </form>
         </paper-material>
     </paper-dialog>
     `;
  }
}

customElements.define('backend-ai-job-view', BackendAIJobView);
