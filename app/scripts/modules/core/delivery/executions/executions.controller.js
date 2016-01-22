'use strict';

let angular = require('angular');

module.exports = angular.module('spinnaker.core.delivery.executions.controller', [
  require('../service/execution.service.js'),
  require('../../pipeline/config/services/pipelineConfigService.js'),
  require('../../utils/scrollTo/scrollTo.service.js'),
  require('../../insight/insightFilterState.model.js'),
  require('../filter/executionFilter.model.js'),
  require('../filter/executionFilter.service.js'),
  require('../create/create.module.js'),
])
  .controller('ExecutionsCtrl', function($scope, $state, $q, $uibModal, $stateParams,
                                         pipelineConfigService, scrollToService, $timeout,
                                         executionService, ExecutionFilterModel, executionFilterService,
                                         InsightFilterStateModel) {

    if (ExecutionFilterModel.mostRecentApplication !== $scope.application.name) {
      ExecutionFilterModel.groups = [];
      ExecutionFilterModel.mostRecentApplication = $scope.application.name;
    }

    let scrollIntoView = (delay = 200) => scrollToService.scrollTo('execution-' + $stateParams.executionId, '.all-execution-groups', 225, delay);

    let application = $scope.application;
    this.application = application;
    if ($scope.application.notFound) {
      return;
    }

    application.loadAllExecutions = true;
    $scope.$on('$destroy', () => application.loadAllExecutions = false);

    this.InsightFilterStateModel = InsightFilterStateModel;

    this.filter = ExecutionFilterModel.sortFilter;

    this.clearFilters = () => {
      executionFilterService.clearFilters();
      this.updateExecutionGroups();
    };

    this.updateExecutionGroups = () => {
      normalizeExecutionNames();
      ExecutionFilterModel.applyParamsToUrl();
      executionFilterService.updateExecutionGroups(this.application);
      this.tags = ExecutionFilterModel.tags;
      // updateExecutionGroups is debounced by 25ms, so we need to delay setting the loading flag a bit
      $timeout(() => { this.viewState.loading = false; }, 50);
    };

    this.viewState = {
      loading: true,
      triggeringExecution: false,
    };

    let executionLoader = application.reloadExecutions(true);

    let deferred = $q.defer();
    let configLoader = deferred.promise;
    if (application.pipelineConfigs) {
      deferred.resolve();
    } else {
      application.pipelineConfigRefreshStream.take(1).subscribe(deferred.resolve);
    }

    $q.all([executionLoader, configLoader]).then(() => {
      this.updateExecutionGroups();
      if ($stateParams.executionId) {
        scrollIntoView();
      }
    });

    $scope.filterCountOptions = [1, 2, 5, 10, 20];

    let dataInitializationFailure = () => {
      this.viewState.loading = false;
      this.viewState.initializationError = true;
    };

    function normalizeExecutionNames() {
      if (application.executionsLoadFailure) {
        dataInitializationFailure();
      }
      let executions = application.executions || [];
      var configurations = application.pipelineConfigs || [];
      executions.forEach(function(execution) {
        if (execution.pipelineConfigId) {
          var configMatches = configurations.filter(function(configuration) {
            return configuration.id === execution.pipelineConfigId;
          });
          if (configMatches.length) {
            execution.name = configMatches[0].name;
          }
        }
      });
    }

    let executionWatcher = this.application.executionRefreshStream.subscribe(normalizeExecutionNames, dataInitializationFailure);
    $scope.$on('$destroy', () => executionWatcher.dispose());

    this.toggleExpansion = (expand) => {
      $scope.$broadcast('toggle-expansion', expand);
    };


    let startPipeline = (command) => {
      this.viewState.triggeringExecution = true;
      return pipelineConfigService.triggerPipeline(this.application.name, command.pipelineName, command.trigger).then(
        (result) => {
          var newPipelineId = result.ref.split('/').pop();
          var monitor = executionService.waitUntilNewTriggeredPipelineAppears(this.application, command.pipelineName, newPipelineId);
          monitor.then(() => {
            this.viewState.triggeringExecution = false;
          });
          this.viewState.poll = monitor;
        },
        () => {
          this.viewState.triggeringExecution = false;
        });
    };

    this.triggerPipeline = () => {
      $uibModal.open({
        templateUrl: require('../manualExecution/manualPipelineExecution.html'),
        controller: 'ManualPipelineExecutionCtrl as vm',
        resolve: {
          pipeline: () => null,
          application: () => this.application,
        }
      }).result.then(startPipeline);
    };

    $scope.$on('$stateChangeSuccess', (event, toState, toParams, fromState, fromParams) => {
      // if we're navigating to a different execution on the same page, scroll the new execution into view
      // or, if we are navigating back to the same execution after scrolling down the page, scroll it into view
      // but don't scroll it into view if we're navigating to a different stage in the same execution
      let shouldScroll = false;
      if (toState.name.indexOf(fromState.name) === 0 && toParams.application === fromParams.application && toParams.executionId) {
        shouldScroll = true;
        if (toParams.executionId === fromParams.executionId && toParams.details) {
          if (toParams.stage !== fromParams.stage || toParams.step !== fromParams.step || toParams.details !== fromParams.details) {
            shouldScroll = false;
          }
        }
      }
      if (shouldScroll) {
        scrollIntoView(0);
      }
    });

  });
